import { expect, test } from "@playwright/test";

test.describe("authentication journey", () => {
  test("new user can register and reach the dashboard", async ({ page }) => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /your friends are waiting/i })).toBeVisible();

    await page.getByRole("button", { name: /sign up here/i }).click();
    await expect(page.getByRole("heading", { name: /new here/i })).toBeVisible();

    await page.getByPlaceholder("First name").fill("QA");
    await page.getByPlaceholder("name@example.com").fill(`qa-e2e-${stamp}@example.com`);
    await page.getByPlaceholder("password").fill("quality-pass-123");
    await page.getByRole("button", { name: /let's go/i }).click();

    await expect(page.getByRole("tab", { name: /my rooms/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /explore rooms/i })).toBeVisible();
    await expect(page.getByLabel(/create a room/i)).toBeVisible();
  });
});
