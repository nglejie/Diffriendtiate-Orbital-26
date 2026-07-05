import { expect, test } from "@playwright/test";
import zlib from "node:zlib";
import { apiRequest, createRoom, expectStatus, joinRoom, registerUser } from "../helpers/apiClient.mts";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";

function escapePdfText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function makeSmokePdf(text = "Document channel smoke test") {
  const stream = `BT /F1 28 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  const xrefRows = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function makePng(width = 420, height = 260) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 62;
      row[offset + 1] = Math.round(98 + (x / width) * 90);
      row[offset + 2] = Math.round(180 + (y / height) * 45);
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND"),
  ]);
}

test("Convolution document channels hide room controls, reject invalid uploads, and render an uploaded PDF", async ({
  page,
}) => {
  const owner = await registerUser(API_BASE, { name: "Document Channel Owner" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Document Channel QA",
    moduleCode: "DOC101",
  });

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^world$/i })).toBeVisible();
  await page.getByRole("button", { name: /^convolution$/i }).click();
  await expect(page.getByRole("heading", { name: /welcome to #general/i })).toBeVisible();

  await page.locator(".chat-category-header", { hasText: /text channels/i }).hover();
  await page.getByRole("button", { name: /create channel in text channels/i }).click();
  await expect(page.getByRole("dialog", { name: /create channel/i })).toBeVisible();
  await expect(page.locator(".room-user-controls")).toHaveCount(0);

  await page.getByRole("radio", { name: /document/i }).check();
  await page.getByLabel(/channel name/i).fill("PDF Smoke");

  await page.locator(".document-channel-upload-input").setInputFiles({
    buffer: Buffer.from("MZ executable placeholder", "utf8"),
    mimeType: "application/x-msdownload",
    name: "installer.exe",
  });

  await expect(
    page.getByText(/Document channels support PDF, DOCX, PPTX, PNG, JPG, JPEG, or WEBP files only\. Remove: installer\.exe\./i),
  ).toBeVisible();
  await page.getByRole("button", { name: /^ok$/i }).click();
  await expect(page.getByRole("dialog", { name: /create channel/i })).toBeVisible();

  await page.locator(".document-channel-upload-input").setInputFiles({
    buffer: makeSmokePdf(),
    mimeType: "application/pdf",
    name: "document-smoke.pdf",
  });

  const resourceCard = page.locator(".chat-document-resource-card", { hasText: "document-smoke.pdf" });
  await expect(resourceCard).toBeVisible();
  await resourceCard.click();
  await page.getByRole("button", { name: /^create channel$/i }).click();

  await expect(page.getByRole("button", { exact: true, name: "pdf-smoke" })).toBeVisible();
  await expect(page.getByText("document-smoke.pdf").first()).toBeVisible();
  await expect(page.getByText(/Converting this/i)).toHaveCount(0);
  await expect(page.locator(".document-pdf-shell canvas").first()).toBeVisible();

  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/channels/pdf-smoke/annotations`, {
      method: "POST",
      token: owner.token,
      body: {
        annotationType: "question",
        comment: "Can someone explain this paragraph?",
        content: { text: "Document channel smoke test" },
        position: {
          boundingRect: { x1: 72, y1: 60, x2: 430, y2: 100, width: 612, height: 792 },
          pageNumber: 1,
          rects: [{ x1: 72, y1: 60, x2: 430, y2: 100, width: 612, height: 792 }],
        },
      },
    }),
    201,
    "create document channel annotation",
  );
  await page.getByRole("button", { exact: true, name: "general" }).click();
  await page.getByRole("button", { exact: true, name: "pdf-smoke" }).click();
  await expect(page.getByText("Can someone explain this paragraph?")).toBeVisible();
  await page.getByRole("button", { name: /^reply$/i }).click();
  await page.getByPlaceholder(/reply to this thread/i).fill("Yes, this is now discussable in Convolution.");
  await page.getByRole("button", { name: /send reply/i }).click();
  await expect(page.getByText("Yes, this is now discussable in Convolution.")).toBeVisible();

  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/channels/pdf-smoke/annotations`, {
      token: owner.token,
    }),
    200,
    "load document channel annotations",
  );
});

test("Convolution image document channels keep shared categories, real PFPs, and image annotations working", async ({
  browser,
  page,
}) => {
  const ownerAvatar = makePng(48, 48).toString("base64");
  const owner = await registerUser(API_BASE, { name: "Image Channel Owner" });
  const member = await registerUser(API_BASE, { name: "Image Channel Member" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Image Channel QA",
    moduleCode: "IMG101",
  });
  await joinRoom(API_BASE, member.token, room.id);
  await expectStatus(
    await apiRequest(API_BASE, "/api/auth/me", {
      method: "PATCH",
      token: owner.token,
      body: {
        avatarPreset: null,
        avatarUrl: `data:image/png;base64,${ownerAvatar}`,
        name: "Image Channel Owner",
      },
    }),
    200,
    "set owner profile picture",
  );
  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/messages`, {
      method: "POST",
      token: owner.token,
      body: { body: "Owner photo proof", channel: "general" },
    }),
    201,
    "create owner PFP proof message",
  );

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^world$/i })).toBeVisible();
  await page.getByRole("button", { name: /^convolution$/i }).click();
  await expect(page.getByText("Owner photo proof")).toBeVisible();

  await page.locator(".chat-category-header", { hasText: /text channels/i }).hover();
  await page.getByRole("button", { name: /create channel in text channels/i }).click();
  await page.getByRole("radio", { name: /document/i }).check();
  await page.getByLabel(/channel name/i).fill("Diagram Lab");
  await page.locator(".document-channel-upload-input").setInputFiles({
    buffer: makePng(),
    mimeType: "image/png",
    name: "diagram-lab.png",
  });

  const imageResourceCard = page.locator(".chat-document-resource-card", { hasText: "diagram-lab.png" });
  await expect(imageResourceCard).toBeVisible();
  await imageResourceCard.click();
  await page.getByRole("button", { name: /^create channel$/i }).click();
  await expect(page.getByRole("button", { exact: true, name: "diagram-lab" })).toBeVisible();

  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/channel-layout`, {
      method: "PATCH",
      token: owner.token,
      body: {
        channelLayout: [
          { id: "default-text-channels", name: "Text Channels", channels: ["general"] },
          { id: "cat-diagrams", name: "Diagrams", channels: ["diagram-lab"] },
        ],
      },
    }),
    200,
    "persist diagram category layout",
  );

  await page.getByRole("button", { exact: true, name: "diagram-lab" }).click();
  await expect(page.getByRole("img", { name: /diagram-lab\.png/i })).toBeVisible();
  const overlay = page.locator(".image-annotation-overlay");
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 80, box!.y + 60);
  await page.mouse.down();
  await page.mouse.move(box!.x + 260, box!.y + 170);
  await page.mouse.up();
  await page.getByLabel(/annotation type/i).click();
  await page.getByRole("option", { name: "Insight" }).click();
  await page.getByPlaceholder(/add context for this region/i).fill("This visual needs a group note.");
  await page.getByRole("button", { name: /save annotation/i }).click();
  await expect(page.getByText("This visual needs a group note.")).toBeVisible();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, member.token);
  await memberPage.goto(`/#/rooms/${room.id}`);
  await expect(memberPage.getByRole("heading", { name: /^world$/i })).toBeVisible();
  await memberPage.getByRole("button", { name: /^convolution$/i }).click();
  await expect(memberPage.getByText("Image Channel Member").first()).toBeVisible();
  await expect(memberPage.getByText(/diagrams/i)).toBeVisible();
  await expect(memberPage.getByRole("button", { exact: true, name: "diagram-lab" })).toBeVisible();
  await expect(memberPage.getByAltText("Image Channel Owner profile picture").first()).toBeVisible();
  await memberPage.getByRole("button", { exact: true, name: "diagram-lab" }).click();
  await expect(memberPage.getByText("This visual needs a group note.")).toBeVisible();
  await memberContext.close();
});
