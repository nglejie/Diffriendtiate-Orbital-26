import { expect, test } from "@playwright/test";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";
const PASSWORD = "CorrectHorseBatteryStaple!42";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

async function registerViaApi(request, name: string, email: string) {
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { name, email, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();

  if (payload.verificationToken) {
    const verificationResponse = await request.post(`${API_BASE}/api/auth/email-verification/confirm`, {
      data: { token: payload.verificationToken },
    });
    expect(verificationResponse.ok()).toBeTruthy();
    return verificationResponse.json();
  }

  return payload;
}

async function createRoomViaApi(request, token: string) {
  const response = await request.post(`${API_BASE}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "Intelligrate Proof",
      moduleCode: "CS2100",
      academicTerm: "2026/2027 S1",
      description: "Proof room for Intelligrate local flows",
      visibility: "public",
      tags: ["proof"],
      theme: "twilight",
      background: "clouds",
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.room;
}

async function saveProofScreenshot(page, testInfo, name: string) {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`${name}.png`),
  });
}

async function sendIntelligratePrompt(page, prompt: string, expected: string, progressPattern?: RegExp) {
  const composer = page.getByPlaceholder("Ask anything");
  await expect(composer).toBeVisible();
  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(expected)).toBeVisible({ timeout: 15_000 });
  if (progressPattern) {
    await expect(page.getByText(progressPattern).last()).toBeVisible();
  }
}

test("proof: Intelligrate supports five complete local browser flows", async ({ page, request }, testInfo) => {
  const owner = await registerViaApi(request, "Intelligrate Proof Owner", uniqueEmail("intelligrate-proof"));
  const room = await createRoomViaApi(request, owner.token);

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);
  await page.goto(`/#/rooms/${room.id}`);
  await page.getByRole("button", { name: "Intelligrate", exact: true }).click();
  await expect(page.getByPlaceholder("Ask anything")).toBeVisible();

  await sendIntelligratePrompt(
    page,
    "What can Intelligrate do in this Domain?",
    "First answer: Intelligrate can answer from the Domain context.",
    /Searching Infilenite for/i,
  );
  await saveProofScreenshot(page, testInfo, "01-first-domain-answer");

  await sendIntelligratePrompt(
    page,
    "Follow up using the previous answer. Do not repeat it.",
    "Follow-up answer 2: Intelligrate used the previous conversation and did not replay the first answer.",
  );
  await expect(page.getByText("First answer: Intelligrate can answer from the Domain context.")).toHaveCount(1);
  await saveProofScreenshot(page, testInfo, "02-follow-up-no-replay");

  await sendIntelligratePrompt(
    page,
    "Are there any Coordidate meetings coming up?",
    "Coordidate answer: the next meeting is on August 14, 2026 at 10:00 AM.",
    /Searching upcoming Coordidate for/i,
  );
  await saveProofScreenshot(page, testInfo, "03-coordidate-query");

  await sendIntelligratePrompt(
    page,
    "What did the Convolution message say?",
    "Convolution answer: the relevant channel message says the project color is blue.",
    /Searching Convolution for/i,
  );
  await saveProofScreenshot(page, testInfo, "04-convolution-query");

  const keyResponse = await request.post(`${API_BASE}/api/auth/llm-api-keys`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: {
      providerId: "gemini",
      label: "Gemini Proof",
      model: "gemini/gemini-flash-lite-latest",
      apiKey: "proof-gemini-key",
    },
  });
  expect(keyResponse.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Intelligrate", exact: true }).click();
  await page.getByRole("button", { name: /Choose Model/i }).click();
  await page.getByRole("option", { name: /Use Gemini Proof/i }).click();

  await sendIntelligratePrompt(
    page,
    "Use my BYOK provider for this question.",
    "BYOK answer: this response was routed through the selected saved provider.",
  );
  await expect(page.getByRole("button", { name: /Choose Model: Gemini Proof/i })).toBeVisible();
  await saveProofScreenshot(page, testInfo, "05-byok-provider-answer");
});
