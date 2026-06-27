import { expect, test } from "@playwright/test";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";
const PASSWORD = "CorrectHorseBatteryStaple!42";
// A 1x1 PNG keeps image-upload flows realistic without storing a large fixture
// in the repository. It is used for both room logo and background upload tests.
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

async function registerThroughUi(page, name, email) {
  // Drive the same registration path a real first-time user would use. The
  // final assertion waits for the dashboard Create Room button, proving login
  // completed and the app shell is ready.
  await page.goto("/");
  await page.getByRole("button", { name: /sign up here/i }).click();
  await page.getByLabel(/first name/i).fill(name);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole("button", { name: /let's go/i }).click();
  await expect(page.getByRole("button", { name: /create room/i })).toBeVisible();
}

async function registerViaApi(request, name, email) {
  // API registration is used when the test only needs fixture users. This keeps
  // the UAT focused on the UI under test instead of repeating registration
  // clicks for every actor.
  const response = await request.post(`${API_BASE}/api/auth/register`, {
    data: { name, email, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createRoomViaApi(request, token, overrides = {}) {
  // Creates a realistic room fixture through the public API for permission
  // checks. Defaults mirror the room fields users provide in the Create Room
  // flow, and overrides let individual tests adjust only what matters.
  const response = await request.post(`${API_BASE}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "Member Visibility Room",
      moduleCode: "CS2040S",
      academicTerm: "2026/2027 S1",
      description: "E2E room",
      visibility: "public",
      tags: ["qa"],
      theme: "twilight",
      background: "clouds",
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// Full owner walkthrough: sign up through the UI, switch theme, create a room
// with custom logo/background uploads, then verify the main room tabs are usable
// and Calendar remains disabled while it is intentionally not supported.
test("UAT: user registers, toggles theme, creates a custom room, and navigates core tabs", async ({ page }) => {
  const email = uniqueEmail("uat-owner");
  await registerThroughUi(page, "UAT Owner", email);

  await page.getByRole("button", { name: /account/i }).click();
  await page.getByRole("button", { name: /switch to light mode/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /create room/i }).click();
  await page.getByRole("button", { name: /create my own/i }).click();
  await page.locator(".room-logo-file-input").setInputFiles({
    buffer: tinyPng,
    mimeType: "image/png",
    name: "qa-logo.png",
  });
  await page.getByLabel(/room name/i).fill("UAT Custom Room");
  await page.getByLabel(/module code/i).fill("CS2040S");
  await page.getByLabel(/description/i).fill("Walkthrough room with custom images.");
  await page.locator(".tag-editor-input input").fill("qa");
  await page.getByRole("button", { name: /^add$/i }).click();
  await page.getByRole("button", { name: /choose background/i }).click();
  await page.locator(".upload-dropzone input[type='file']").setInputFiles({
    buffer: tinyPng,
    mimeType: "image/png",
    name: "qa-background.png",
  });
  await page
    .getByRole("dialog", { name: /set the scene/i })
    .getByRole("button", { name: /^create room$/i })
    .click();

  await expect(page).toHaveURL(/#\/rooms\//);
  await expect(page.getByText("UAT Custom Room").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /room settings/i })).toBeVisible();

  await page.getByRole("button", { name: /^chat$/i }).click();
  await expect(page.getByRole("heading", { name: /welcome to #general/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /general options/i })).toBeVisible();

  await page.getByRole("button", { name: /^resources$/i }).click();
  await expect(page.getByRole("heading", { name: /resources/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /new folder/i })).toBeVisible();

  await page.getByRole("button", { name: /^intelligrate$/i }).click();
  await expect(page.getByText(/intelligrate/i).first()).toBeVisible();

  await expect(page.getByRole("button", { name: /^calendar$/i })).toBeDisabled();
});

// Permission UAT: create an owner/member pair, join the member to the room, and
// load the room as that member. The member should see normal room content but no
// owner-only settings, channel creation, or channel options controls.
test("UAT: non-owner members cannot see room management controls", async ({ page, request }) => {
  const ownerPayload = await registerViaApi(request, "E2E Owner", uniqueEmail("e2e-owner"));
  const memberPayload = await registerViaApi(request, "E2E Member", uniqueEmail("e2e-member"));
  const { room } = await createRoomViaApi(request, ownerPayload.token);

  const join = await request.post(`${API_BASE}/api/rooms/${room.id}/join`, {
    headers: { Authorization: `Bearer ${memberPayload.token}` },
  });
  expect(join.ok()).toBeTruthy();

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, memberPayload.token);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByText("Member Visibility Room").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /room settings/i })).toHaveCount(0);

  await page.getByRole("button", { name: /^chat$/i }).click();
  await expect(page.getByRole("button", { name: /create channel in text channels/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /general options/i })).toHaveCount(0);
});
