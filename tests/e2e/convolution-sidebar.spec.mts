import { expect, test } from "@playwright/test";
import { apiRequest, createRoom, expectStatus, joinRoom, registerUser } from "../helpers/apiClient.mts";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";

test("Convolution owners create and rename categories from explicit sidebar controls", async ({
  browser,
  page,
}) => {
  const owner = await registerUser(API_BASE, { name: "Sidebar Owner" });
  const member = await registerUser(API_BASE, { name: "Sidebar Member" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Convolution Sidebar QA",
    moduleCode: "SIDE101",
  });
  await joinRoom(API_BASE, member.token, room.id);

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^world$/i })).toBeVisible();
  await page.getByRole("button", { name: /^convolution$/i }).click();
  await expect(page.getByRole("heading", { name: /welcome to #general/i })).toBeVisible();

  await expect(page.getByRole("button", { name: /new category/i })).toBeVisible();
  await page.locator(".chat-sidebar").click({ button: "right", position: { x: 80, y: 220 } });
  await expect(page.getByRole("button", { name: /^create category$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^create channel$/i })).toHaveCount(0);

  await page.getByRole("button", { name: /new category/i }).click();
  await expect(page.getByRole("dialog", { name: /create category/i })).toBeVisible();
  await page.getByLabel(/category name/i).fill("Assignment Help");
  await page.getByRole("button", { name: /^create category$/i }).click();
  await expect(page.locator(".chat-category-header", { hasText: "Assignment Help" })).toBeVisible();

  await page.locator(".chat-category-header", { hasText: "Assignment Help" }).hover();
  await page.getByRole("button", { name: /assignment help options/i }).click();
  await page.getByRole("button", { name: /rename category/i }).click();
  await expect(page.getByRole("dialog", { name: /rename category/i })).toBeVisible();
  await page.getByLabel(/category name/i).fill("Consultation");
  await page.getByRole("button", { name: /^rename$/i }).click();
  await expect(page.locator(".chat-category-header", { hasText: "Consultation" })).toBeVisible();
  await expect(page.locator(".chat-category-header", { hasText: "Assignment Help" })).toHaveCount(0);

  await page.locator(".chat-category-header", { hasText: /text channels/i }).hover();
  await page.getByRole("button", { name: /create channel in text channels/i }).click();
  await expect(page.getByRole("dialog", { name: /create channel/i })).toBeVisible();
  await page.getByLabel(/channel name/i).fill("Study Questions");
  await page.getByRole("button", { name: /^create channel$/i }).click();
  await expect(page.getByRole("button", { exact: true, name: "study-questions" })).toBeVisible();

  const studyQuestionsRow = page.locator(".chat-channel-row", { hasText: "study-questions" });
  const consultationSection = page.locator(".chat-category-section", { hasText: "Consultation" });
  await studyQuestionsRow.dragTo(consultationSection);
  await expect(
    consultationSection.getByRole("button", { exact: true, name: "study-questions" }),
  ).toBeVisible();

  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}`, { token: owner.token }),
    200,
    "reload owner room after category rename",
  );

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, member.token);
  await memberPage.goto(`/#/rooms/${room.id}`);
  await expect(memberPage.getByRole("heading", { name: /^world$/i })).toBeVisible();
  await memberPage.getByRole("button", { name: /^convolution$/i }).click();
  await expect(memberPage.locator(".chat-category-header", { hasText: "Consultation" })).toBeVisible();
  await expect(
    memberPage
      .locator(".chat-category-section", { hasText: "Consultation" })
      .getByRole("button", { exact: true, name: "study-questions" }),
  ).toBeVisible();
  await expect(memberPage.getByRole("button", { name: /new category/i })).toHaveCount(0);
  await memberContext.close();
});
