import { expect, test } from "@playwright/test";

// A tiny PNG lets the profile editor exercise the real image-preview path
// without needing a checked-in binary fixture.
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

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

    await expect(page.getByRole("tab", { name: /my domains/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /explore domains/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /create domain/i })).toBeVisible();

    const accountButton = page.getByRole("button", { name: /account menu for qa/i });
    const accountAvatar = page.locator(".dashboard-account-avatar");
    const accountButtonBox = await accountButton.boundingBox();
    const accountAvatarBox = await accountAvatar.boundingBox();
    expect(accountButtonBox).toBeTruthy();
    expect(accountAvatarBox).toBeTruthy();
    expect(Math.abs(accountButtonBox!.width - accountAvatarBox!.width)).toBeLessThan(0.5);
    expect(Math.abs(accountButtonBox!.height - accountAvatarBox!.height)).toBeLessThan(0.5);

    await accountButton.click();
    await expect(page.getByRole("menuitem", { name: /settings/i })).toBeDisabled();
    await page.getByRole("menuitem", { name: /^profile$/i }).click();

    const profileDialog = page.getByRole("dialog", { name: /edit profile/i });
    await expect(profileDialog).toBeVisible();

    const profilePictureButton = profileDialog.getByRole("button", { name: /change profile picture/i });
    const avatarButton = profileDialog.getByRole("button", { name: /change limeets avatar/i });
    await expect(profilePictureButton).toHaveCSS("border-radius", "18px");
    await expect(profilePictureButton).toHaveCSS("border-top-width", "0px");
    await expect(avatarButton).toHaveCSS("border-radius", "18px");

    await profileDialog.locator("input[type='file']").setInputFiles({
      buffer: tinyPng,
      mimeType: "image/png",
      name: "profile-picture.png",
    });
    const profileImage = profilePictureButton.locator("img");
    await expect(profileImage).toBeVisible();
    await expect(profileImage).toHaveCSS("object-fit", "cover");

    const profilePictureButtonBox = await profilePictureButton.boundingBox();
    const profileImageBox = await profileImage.boundingBox();
    expect(profilePictureButtonBox).toBeTruthy();
    expect(profileImageBox).toBeTruthy();
    expect(Math.abs(profilePictureButtonBox!.x - profileImageBox!.x)).toBeLessThan(1);
    expect(Math.abs(profilePictureButtonBox!.y - profileImageBox!.y)).toBeLessThan(1);
    expect(Math.abs(profilePictureButtonBox!.width - profileImageBox!.width)).toBeLessThan(1);
    expect(Math.abs(profilePictureButtonBox!.height - profileImageBox!.height)).toBeLessThan(1);

    const avatarPreview = avatarButton.locator(".limeets-avatar-stack.profile");
    await expect(avatarPreview).toBeVisible();
    await expect(avatarPreview).toHaveCSS("transform", "none");
    const avatarButtonBox = await avatarButton.boundingBox();
    const avatarPreviewBox = await avatarPreview.boundingBox();
    expect(avatarButtonBox).toBeTruthy();
    expect(avatarPreviewBox).toBeTruthy();
    expect(avatarPreviewBox!.x).toBeGreaterThanOrEqual(avatarButtonBox!.x);
    expect(avatarPreviewBox!.y).toBeGreaterThanOrEqual(avatarButtonBox!.y);
    expect(avatarPreviewBox!.x + avatarPreviewBox!.width).toBeLessThanOrEqual(
      avatarButtonBox!.x + avatarButtonBox!.width,
    );
    expect(avatarPreviewBox!.y + avatarPreviewBox!.height).toBeLessThanOrEqual(
      avatarButtonBox!.y + avatarButtonBox!.height,
    );

    const profileDialogBox = await profileDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(profileDialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(profileDialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(profileDialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(profileDialogBox!.x + profileDialogBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(profileDialogBox!.y + profileDialogBox!.height).toBeLessThanOrEqual(viewport!.height);
    expect(Math.abs(profileDialogBox!.x + profileDialogBox!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
    expect(Math.abs(profileDialogBox!.y + profileDialogBox!.height / 2 - viewport!.height / 2)).toBeLessThan(2);
  });
});
