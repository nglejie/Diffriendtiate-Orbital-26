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

async function createWorldViaApi(request, token: string) {
  const response = await request.post(`${API_BASE}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      academicTerm: "2026/2027 S1",
      background: "clouds",
      description: "Area editor styling regression world",
      moduleCode: "CS2040S",
      name: "Area Editor World",
      tags: ["qa"],
      theme: "twilight",
      visibility: "public",
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("Limeets Area Editor stacks removable area properties with consistent styling", async ({ page, request }) => {
  const owner = await registerViaApi(request, "Area Editor Owner", uniqueEmail("area-editor-owner"));
  const { room } = await createWorldViaApi(request, owner.token);

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await page.getByRole("button", { name: /customise/i }).click();
  await page.getByRole("button", { name: /^area editor$/i }).click();
  await expect(page.getByText("No Areas Yet. Drag on the map to create one.")).toBeVisible();

  const viewport = page.locator(".limeets-gather-viewport");
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).toBeTruthy();
  await page.mouse.move(viewportBox!.x + 170, viewportBox!.y + 250);
  await page.mouse.down();
  await page.mouse.move(viewportBox!.x + 310, viewportBox!.y + 340);
  await page.mouse.up();

  const selectedPanel = page.locator(".limeets-gather-area-selected");
  await expect(selectedPanel).toBeVisible();
  await expect(page.locator(".limeets-gather-area-editor-heading")).toContainText("All Areas");
  await expect(page.locator(".limeets-gather-editor-header").getByText("Special Areas")).toHaveCount(0);
  await expect(selectedPanel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(selectedPanel).toHaveCSS("border-top-width", "0px");
  await expect(selectedPanel).toHaveCSS("padding-top", "0px");

  const actionButtons = selectedPanel.locator(".selected-area-actions > button");
  await expect(actionButtons).toHaveCount(6);
  expect(await actionButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("title")))).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  const actionRows = await actionButtons.evaluateAll((buttons) => [
    ...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))),
  ]);
  expect(actionRows).toHaveLength(1);
  await expect(selectedPanel.locator(".limeets-gather-danger")).toHaveCount(0);

  await selectedPanel.getByRole("button", { name: /meeting area\. join limeets/i }).click();
  await selectedPanel.getByRole("button", { name: /open link\. attach a link/i }).click();
  await selectedPanel.getByRole("button", { name: /block movement\. make the whole/i }).click();

  const cards = selectedPanel.locator(".limeets-gather-area-property-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Meeting Area");
  await expect(cards.nth(1)).toContainText("Open Link");
  await expect(cards.nth(2)).toContainText("Block Movement");
  await expect(cards.nth(0)).not.toContainText("Members entering this region");
  await expect(cards.nth(1)).not.toContainText("Attach a link interaction");
  await expect(cards.nth(2)).not.toContainText("Members cannot walk through");

  const openLinkCard = cards.filter({ hasText: "Open Link" });
  await expect(openLinkCard.getByText("Interaction", { exact: true })).toBeVisible();
  await expect(openLinkCard.getByText("Link URL", { exact: true })).toBeVisible();
  await expect(openLinkCard.getByLabel("Open in new tab")).toBeVisible();
  await openLinkCard.getByPlaceholder("https://...").fill("www.google.com");
  await openLinkCard.getByLabel("Open in new tab").check();
  await expect(openLinkCard.getByLabel("Open in new tab")).toBeChecked();
  const interactionSelect = openLinkCard.getByRole("button", { exact: true, name: "Interaction" });
  await interactionSelect.click();
  await page.getByRole("option", { name: "Open When Entering" }).click();
  await expect(interactionSelect).toContainText("Open When Entering");
  await expect(openLinkCard.getByLabel("Hide URL")).toHaveCount(0);
  await expect(openLinkCard.getByLabel("Can be closed")).toHaveCount(0);
  await expect(openLinkCard.getByLabel("Allow scripting API")).toHaveCount(0);
  await expect(openLinkCard.getByText(/Panel Width:/)).toHaveCount(0);

  const removeButtons = cards.locator(".limeets-gather-area-property-remove");
  await expect(removeButtons.first()).toHaveCSS("border-top-width", "0px");
  await expect(removeButtons.first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const removeColour = await removeButtons.first().evaluate((button) => getComputedStyle(button).color);
  expect(removeColour).not.toBe("rgb(246, 193, 119)");

  await openLinkCard.getByRole("button", { name: /^open link/i }).click();
  await expect(openLinkCard.getByText("Link URL")).toHaveCount(0);
  await openLinkCard.getByRole("button", { name: /remove open link/i }).click();
  await expect(cards).toHaveCount(2);
});
