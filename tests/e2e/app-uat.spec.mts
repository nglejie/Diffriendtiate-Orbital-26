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
  // final assertion waits for the dashboard Create Domain button, proving login
  // completed and the app shell is ready.
  await page.goto("/");
  await page.getByRole("button", { name: /register/i }).click();
  await page.getByPlaceholder("Username").fill(name);
  await page.getByPlaceholder("Email Address").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(PASSWORD);
  const registrationResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /create account/i }).click();
  const registrationPayload = await registrationResponsePromise.then((response) => response.json());
  expect(registrationPayload.verificationToken).toBeTruthy();
  await page.goto(`/#/verify-email?token=${encodeURIComponent(registrationPayload.verificationToken)}`);
  await expect(page.getByRole("button", { name: /create domain/i })).toBeVisible();
}

async function registerViaApi(request, name, email) {
  // API registration is used when the test only needs fixture users. This keeps
  // the UAT focused on the UI under test instead of repeating registration
  // clicks for every actor.
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

async function createRoomViaApi(request, token, overrides = {}) {
  // Creates a realistic room fixture through the public API for permission
  // checks. Defaults mirror the room fields users provide in the Create Domain
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
// with custom logo/background uploads, then verify the renamed World shell tabs
// are usable and Coordidate opens its scheduler surface.
test("UAT: user registers, toggles theme, creates a custom room, and navigates core tabs", async ({ page }) => {
  const email = uniqueEmail("uat-owner");
  await registerThroughUi(page, "UAT Owner", email);

  await page.getByRole("button", { name: /account/i }).click();
  await page.getByRole("button", { name: /switch to light mode/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /create domain/i }).click();
  await page.getByRole("button", { name: /create my own/i }).click();
  const academicTermWrapper = page.locator(".academic-term-select");
  await expect(academicTermWrapper).toBeVisible();
  await expect(academicTermWrapper).toHaveCSS("border-top-width", "0px");
  await expect(academicTermWrapper).toHaveCSS("box-shadow", "none");
  await page.locator(".room-logo-file-input").setInputFiles({
    buffer: tinyPng,
    mimeType: "image/png",
    name: "qa-logo.png",
  });
  const worldNameInput = page.getByLabel(/domain name/i);
  await worldNameInput.fill("UAT Custom Room With Extra Characters");
  await expect(worldNameInput).toHaveValue("UAT Custom Room With");
  const worldNameHelp = page.getByRole("button", { name: /maximum 20 characters/i });
  await worldNameHelp.hover();
  const worldNameTooltip = page.getByRole("tooltip");
  await expect(worldNameTooltip).toContainText(/maximum 20 characters/i);
  const worldNameTooltipBox = await worldNameTooltip.boundingBox();
  const worldNameViewport = page.viewportSize();
  expect(worldNameTooltipBox).toBeTruthy();
  expect(worldNameViewport).toBeTruthy();
  expect(worldNameTooltipBox!.width).toBeLessThan(220);
  expect(worldNameTooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(worldNameTooltipBox!.x + worldNameTooltipBox!.width).toBeLessThanOrEqual(worldNameViewport!.width);
  const courseCodeInput = page.getByLabel(/course code/i);
  await courseCodeInput.hover();
  await courseCodeInput.fill("CS20");
  const courseCodeError = page.getByRole("button", { name: /invalid nus code format/i });
  await expect(courseCodeError).toBeVisible();
  await courseCodeError.hover();
  const courseCodeTooltip = page.getByRole("tooltip");
  await expect(courseCodeTooltip).toContainText(/course code should use 2-3 letters/i);
  const courseCodeTooltipBox = await courseCodeTooltip.boundingBox();
  const viewport = page.viewportSize();
  expect(courseCodeTooltipBox).toBeTruthy();
  expect(viewport).toBeTruthy();
  expect(courseCodeTooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(courseCodeTooltipBox!.y).toBeGreaterThanOrEqual(0);
  expect(courseCodeTooltipBox!.x + courseCodeTooltipBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(courseCodeTooltipBox!.y + courseCodeTooltipBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(page.getByRole("button", { name: /choose background/i })).toBeDisabled();
  await courseCodeInput.fill("CS2040S");
  const descriptionInput = page.getByLabel(/description/i);
  const longDescription = Array.from({ length: 105 }, (_, index) => `word${index + 1}`).join(" ");
  await descriptionInput.fill(longDescription);
  const limitedDescription = await descriptionInput.inputValue();
  expect(limitedDescription.trim().split(/\s+/)).toHaveLength(100);
  expect(limitedDescription.endsWith("word100")).toBe(true);
  expect(limitedDescription).not.toContain("word101");
  await page.locator(".tag-editor-input input").fill("qa");
  await page.getByRole("button", { name: /^add$/i }).click();
  await page.getByRole("button", { name: /choose background/i }).click();
  const scenePreviewLogo = page.locator(".room-preview .room-avatar");
  const scenePreviewLogoImage = page.locator(".room-preview .room-avatar img");
  await expect(scenePreviewLogoImage).toBeVisible();
  await expect(scenePreviewLogo).toHaveCSS("padding-top", "0px");
  await expect(scenePreviewLogo).toHaveCSS("padding-right", "0px");
  const scenePreviewLogoBox = await scenePreviewLogo.boundingBox();
  const scenePreviewLogoImageBox = await scenePreviewLogoImage.boundingBox();
  expect(scenePreviewLogoBox).toBeTruthy();
  expect(scenePreviewLogoImageBox).toBeTruthy();
  const scenePreviewLogoBorder = await scenePreviewLogo.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      left: Number.parseFloat(styles.borderLeftWidth) || 0,
      right: Number.parseFloat(styles.borderRightWidth) || 0,
      top: Number.parseFloat(styles.borderTopWidth) || 0,
      bottom: Number.parseFloat(styles.borderBottomWidth) || 0,
    };
  });
  expect(
    Math.abs(
      scenePreviewLogoBox!.width -
        scenePreviewLogoBorder.left -
        scenePreviewLogoBorder.right -
        scenePreviewLogoImageBox!.width,
    ),
  ).toBeLessThan(1);
  expect(
    Math.abs(
      scenePreviewLogoBox!.height -
        scenePreviewLogoBorder.top -
        scenePreviewLogoBorder.bottom -
        scenePreviewLogoImageBox!.height,
    ),
  ).toBeLessThan(1);
  await page.locator(".upload-dropzone input[type='file']").setInputFiles({
    buffer: tinyPng,
    mimeType: "image/png",
    name: "qa-background.png",
  });
  await page
    .getByRole("dialog", { name: /set the scene/i })
    .getByRole("button", { name: /^create domain$/i })
    .click();

  await expect(page).toHaveURL(/#\/rooms\//);
  await expect(page.getByRole("button", { name: "UAT Custom Room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /domain settings/i })).toBeVisible();
  const ownerCrownIcon = page.locator(".member-owner-crown svg").first();
  await expect(ownerCrownIcon).toHaveCSS("fill", "rgb(255, 255, 255)");
  await expect(ownerCrownIcon).toHaveCSS("stroke", "rgb(255, 255, 255)");

  await page.getByRole("button", { name: /domain settings/i }).click();
  const settings = page.getByRole("dialog", { name: /domain profile/i });
  const settingsShell = page.locator(".room-settings-screen");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: /^domain profile$/i })).toBeVisible();
  await expect(settings.getByText("Room Profile")).toHaveCount(0);
  await expect(settings.getByText("Delete Room")).toHaveCount(0);
  const settingsBox = await settingsShell.boundingBox();
  const settingsViewport = page.viewportSize();
  expect(settingsBox).toBeTruthy();
  expect(settingsViewport).toBeTruthy();
  expect(Math.round(settingsBox!.x)).toBe(0);
  expect(Math.round(settingsBox!.width)).toBe(settingsViewport!.width);

  await page.route("**/api/rooms/*/integrations/canvas/courses", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        courses: [
          {
            courseCode: "CS2040S",
            id: "course-cs2040s",
            name: "Data Structures and Algorithms",
          },
        ],
      }),
    });
  });
  await settingsShell.getByRole("button", { name: /^integrations$/i }).click();
  await expect(settingsShell.getByRole("heading", { name: /^integrations$/i })).toBeVisible();
  await settingsShell.locator("input[type='password']").fill("canvas-test-token");
  const accessTokenHelp = settingsShell.getByRole("button", { name: /new access token/i });
  await accessTokenHelp.hover();
  const tokenTooltip = page.getByRole("tooltip");
  await expect(tokenTooltip).toContainText(/new access token/i);
  await expect(tokenTooltip.locator("img")).toBeVisible();
  const tokenTooltipBox = await tokenTooltip.boundingBox();
  const tokenTooltipViewport = page.viewportSize();
  expect(tokenTooltipBox).toBeTruthy();
  expect(tokenTooltipViewport).toBeTruthy();
  expect(tokenTooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(tokenTooltipBox!.y).toBeGreaterThanOrEqual(0);
  expect(tokenTooltipBox!.x + tokenTooltipBox!.width).toBeLessThanOrEqual(tokenTooltipViewport!.width);
  expect(tokenTooltipBox!.y + tokenTooltipBox!.height).toBeLessThanOrEqual(tokenTooltipViewport!.height);
  await settingsShell.getByRole("button", { name: /^connect$/i }).click();
  await expect(settingsShell.getByText("Course / Module")).toBeVisible();
  await expect(settingsShell.getByText("Module / Class")).toHaveCount(0);
  await expect(settingsShell.getByText("Canvas connected. Choose one module")).toHaveCount(0);
  const courseHelp = settingsShell.getByRole("button", { name: /choose one course for this domain/i });
  await courseHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText("Canvas connected. Choose one course for this Domain.");
  const courseSelectButton = settingsShell.locator(".integration-course-select .app-select-menu-button");
  await expect(courseSelectButton).toHaveCSS("justify-content", "space-between");
  await expect(courseSelectButton).toHaveCSS("text-align", "left");
  await courseSelectButton.click();
  const courseOption = settingsShell.getByRole("option", { name: /CS2040S - Data Structures and Algorithms/i });
  await expect(courseOption).toHaveCSS("justify-content", "space-between");
  await courseOption.click();

  await settingsShell.getByRole("button", { name: /^delete domain$/i }).click();
  await expect(settingsShell.getByRole("heading", { name: /^delete domain$/i })).toBeVisible();
  await page.locator(".delete-room-panel .danger-button").click();
  const deleteConfirm = page.getByRole("alertdialog", { name: /^delete domain$/i });
  await expect(deleteConfirm).toBeVisible();
  const layerState = await page.evaluate(() => {
    const settingsLayer = document.querySelector(".room-settings-screen");
    const confirmLayer = document.querySelector(".confirm-dialog")?.closest(".modal-backdrop");
    return {
      confirmZ: Number.parseInt(window.getComputedStyle(confirmLayer!).zIndex, 10),
      settingsZ: Number.parseInt(window.getComputedStyle(settingsLayer!).zIndex, 10),
    };
  });
  expect(layerState.confirmZ).toBeGreaterThan(layerState.settingsZ);
  await expect(deleteConfirm.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
  await deleteConfirm.getByRole("button", { name: /close delete domain/i }).click();
  await expect(deleteConfirm).toHaveCount(0);
  await settingsShell.getByRole("button", { name: /close domain settings/i }).click();
  await expect(settingsShell).toHaveCount(0);

  await page.getByRole("button", { name: /^convolution$/i }).click();
  await expect(page.getByRole("heading", { name: /welcome to #general/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /general options/i })).toBeVisible();

  await page.getByRole("button", { name: /^infilenite$/i }).click();
  await expect(page.getByRole("button", { name: /new folder/i })).toBeVisible();

  await page.getByRole("button", { name: /^intelligrate$/i }).click();
  await expect(page.getByText(/intelligrate/i).first()).toBeVisible();

  await page.getByRole("button", { name: /^coordidate$/i }).click();
  await expect(page.getByRole("region", { name: "Coordidate" })).toBeVisible();
});

// Invite UAT: private worlds require both an invite link/code and the world
// password. The Create Domain modal must expose that password field and pass it
// through to the existing invite join endpoint.
test("UAT: member joins a private world from an invite with password", async ({ page, request }) => {
  const ownerPayload = await registerViaApi(request, "Invite Owner", uniqueEmail("invite-owner"));
  const { room } = await createRoomViaApi(request, ownerPayload.token, {
    name: "Private Invite World",
    visibility: "private",
    password: "room-password",
  });

  expect(room.inviteCode).toBeTruthy();

  await registerThroughUi(page, "Invite Member", uniqueEmail("invite-member"));
  await page.getByRole("button", { name: /create domain/i }).click();
  await page.getByRole("button", { name: /join a domain/i }).click();
  await expect(page.getByRole("heading", { name: /join a domain/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /join a room/i })).toHaveCount(0);

  await page.getByPlaceholder(/paste an invite code or link/i).fill(room.inviteCode);
  await page.getByLabel(/domain invite password/i).fill("room-password");
  await page.getByRole("button", { name: /join domain/i }).click();

  await expect.poll(() => page.url()).toContain(`#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await expect(page.getByText("Invite Member").first()).toBeVisible();
  await expect(page.getByText("Invite Owner").first()).toBeVisible();
  await expect(page.locator(".member-owner-crown")).toHaveCount(1);
  await expect(page.locator(".crown-badge")).toHaveCount(0);
});

// Direct invite UAT: opening an invite link should use the same Join a Domain
// dialog as the dashboard flow, with the invite code prefilled.
test("UAT: direct private invite link opens the Join a Domain dialog", async ({ page, request }) => {
  const ownerPayload = await registerViaApi(request, "Direct Invite Owner", uniqueEmail("direct-owner"));
  const memberPayload = await registerViaApi(request, "Direct Invite Member", uniqueEmail("direct-member"));
  const { room } = await createRoomViaApi(request, ownerPayload.token, {
    name: "Direct Private World",
    visibility: "private",
    password: "room-password",
  });

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, memberPayload.token);

  await page.goto(`/#/invite/${room.inviteCode}`);
  await expect(page.getByRole("heading", { name: /join a domain/i })).toBeVisible();
  await expect(page.getByPlaceholder(/paste an invite code or link/i)).toHaveValue(room.inviteCode);
  await expect(page.getByRole("heading", { name: /enter room password/i })).toHaveCount(0);

  await page.getByLabel(/domain invite password/i).fill("room-password");
  await page.getByRole("button", { name: /join domain/i }).click();

  await expect.poll(() => page.url()).toContain(`#/rooms/${room.id}`);
  await expect(page.getByText("Direct Invite Member").first()).toBeVisible();
  await expect(page.getByText("Direct Invite Owner").first()).toBeVisible();
});

// Explore preview UAT: the join preview should match the visual metadata style
// used by dashboard world cards: compact member count, top-right tags, and the
// dot-separated course/term line from the create-world banner.
test("UAT: Explore Domains preview shows card-style metadata", async ({ page, request }) => {
  const ownerPayload = await registerViaApi(request, "Explore Preview Owner", uniqueEmail("explore-preview-owner"));
  await createRoomViaApi(request, ownerPayload.token, {
    academicTerm: "2027/2028 S1",
    moduleCode: "FE5101",
    name: "Explore Preview World",
    tags: ["study", "markets"],
    visibility: "public",
  });
  await createRoomViaApi(request, ownerPayload.token, {
    academicTerm: "2027/2028 S1",
    moduleCode: "FE5101",
    name: "Untagged Preview World",
    tags: [],
    visibility: "public",
  });

  await registerThroughUi(page, "Explore Preview Member", uniqueEmail("explore-preview-member"));
  await page.getByRole("tab", { name: /explore domains/i }).click();
  await page.getByPlaceholder(/search domains/i).fill("Explore Preview World");

  const card = page.locator(".gallery-room-card").filter({ hasText: "Explore Preview World" });
  await expect(card).toBeVisible();
  await card.locator(".gallery-cover").click();

  const preview = page.getByRole("dialog", { name: /preview/i });
  await expect(preview).toBeVisible();
  await expect(preview.locator(".world-preview-member-count")).toHaveText("1");
  await expect(preview.locator(".world-preview-member-count")).not.toContainText(/members/i);
  await expect(preview.locator(".world-preview-tags")).toContainText("study");
  await expect(preview.locator(".world-preview-tags")).toContainText("markets");
  await expect(preview.getByText("FE5101 · 2027/2028 S1")).toBeVisible();

  const memberBox = await preview.locator(".world-preview-member-count").boundingBox();
  const tagsBox = await preview.locator(".world-preview-tags").boundingBox();
  const previewBox = await preview.boundingBox();
  const closeButtonBox = await preview.getByRole("button", { name: /close/i }).boundingBox();
  expect(memberBox).toBeTruthy();
  expect(tagsBox).toBeTruthy();
  expect(previewBox).toBeTruthy();
  expect(closeButtonBox).toBeTruthy();
  expect(tagsBox!.x).toBeGreaterThan(memberBox!.x);
  expect(closeButtonBox!.x).toBeGreaterThan(previewBox!.x);
  expect(closeButtonBox!.y).toBeGreaterThan(previewBox!.y);
  expect(closeButtonBox!.x + closeButtonBox!.width).toBeLessThanOrEqual(previewBox!.x + previewBox!.width);
  expect(closeButtonBox!.y + closeButtonBox!.height).toBeLessThanOrEqual(previewBox!.y + 70);

  await preview.getByRole("button", { name: /close/i }).click();
  await page.getByPlaceholder(/search domains/i).fill("Untagged Preview World");
  const untaggedCard = page.locator(".gallery-room-card").filter({ hasText: "Untagged Preview World" });
  await expect(untaggedCard).toBeVisible();
  await expect(untaggedCard.locator(".room-card-tags")).toHaveCount(0);
  await untaggedCard.locator(".gallery-cover").click();

  const untaggedPreview = page.getByRole("dialog", { name: /preview/i });
  await expect(untaggedPreview).toBeVisible();
  await expect(untaggedPreview.locator(".world-preview-tags")).toHaveCount(0);
});

// Permission UAT: create an owner/member pair, join the member to the room, and
// load the room as that member. The member should see normal room content but no
// owner-only domain settings, channel creation, or channel options controls. They
// should instead get a real Leave Domain action that removes their membership.
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
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await expect(page.getByText("E2E Member").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /domain settings/i })).toHaveCount(0);
  const leaveWorldButton = page.getByRole("button", { name: /^leave domain$/i });
  await expect(leaveWorldButton).toBeVisible();
  await expect(leaveWorldButton.locator("svg")).toHaveClass(/lucide-log-out/);
  expect(await leaveWorldButton.getAttribute("title")).toBeNull();

  const tapOutButton = page.getByRole("button", { name: /^tap out$/i });
  await expect(tapOutButton.locator("svg")).toHaveClass(/lucide-bed/);
  expect(await tapOutButton.getAttribute("title")).toBeNull();
  await tapOutButton.hover();
  const tapOutTooltip = page.getByRole("tooltip", { name: "Tap Out" });
  await expect(tapOutTooltip).toBeVisible();
  const tapOutTooltipState = await page.evaluate(() => {
    const bubble = document.querySelector(".app-tooltip-floating");
    const caretElement = document.querySelector(".app-tooltip-floating__caret");
    const caret = window.getComputedStyle(caretElement!);
    return {
      bubbleOpacity: window.getComputedStyle(bubble!).opacity,
      caretBorders: [
        caret.borderTopWidth,
        caret.borderRightWidth,
        caret.borderBottomWidth,
        caret.borderLeftWidth,
      ],
      caretClipPath: caret.clipPath,
      caretHeight: Number.parseFloat(caret.height),
      caretOpacity: caret.opacity,
    };
  });
  expect(tapOutTooltipState.bubbleOpacity).toBe("1");
  expect(tapOutTooltipState.caretOpacity).toBe("1");
  expect(tapOutTooltipState.caretBorders.some((width) => width !== "0px")).toBe(true);
  expect(tapOutTooltipState.caretClipPath).toBe("none");
  expect(tapOutTooltipState.caretHeight).toBeGreaterThanOrEqual(10);

  const unmuteButton = page.getByRole("button", { name: /^unmute$/i });
  await expect(unmuteButton).toHaveClass(/danger active/);
  expect(await unmuteButton.getAttribute("title")).toBeNull();

  const deafenButton = page.getByRole("button", { name: /^deafen$/i });
  await expect(deafenButton.locator("svg")).toHaveClass(/lucide-headphones/);
  await deafenButton.click();
  const undeafenButton = page.getByRole("button", { name: /^undeafen$/i });
  await expect(undeafenButton).toHaveClass(/danger active/);
  await expect(undeafenButton.locator("svg")).toHaveClass(/lucide-headphone-off/);
  expect(await undeafenButton.getAttribute("title")).toBeNull();

  await page.getByRole("button", { name: /^convolution$/i }).click();
  await page.getByRole("button", { name: /^convolution$/i }).hover();
  const railTooltip = page.getByRole("tooltip", { name: "Convolution" });
  await expect(railTooltip).toBeVisible();
  const railTooltipState = await page.evaluate(() => {
    const bubble = document.querySelector(".app-tooltip-floating");
    const caretElement = document.querySelector(".app-tooltip-floating__caret");
    const caret = window.getComputedStyle(caretElement!);
    return {
      bubbleMinHeight: Number.parseFloat(window.getComputedStyle(bubble!).minHeight),
      bubbleOpacity: window.getComputedStyle(bubble!).opacity,
      caretBorders: [
        caret.borderTopWidth,
        caret.borderRightWidth,
        caret.borderBottomWidth,
        caret.borderLeftWidth,
      ],
      caretClipPath: caret.clipPath,
      caretOpacity: caret.opacity,
    };
  });
  expect(railTooltipState.bubbleOpacity).toBe("1");
  expect(railTooltipState.caretOpacity).toBe("1");
  expect(railTooltipState.caretBorders.some((width) => width !== "0px")).toBe(true);
  expect(railTooltipState.caretClipPath).toBe("none");
  expect(railTooltipState.bubbleMinHeight).toBeGreaterThanOrEqual(30);
  await expect(page.getByRole("button", { name: /create channel in text channels/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /general options/i })).toHaveCount(0);

  await leaveWorldButton.click();
  const leaveDialog = page.getByRole("alertdialog", { name: /^leave domain$/i });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: /^leave domain$/i }).click();
  await expect(page.getByRole("button", { name: /create domain/i })).toBeVisible();

  const memberRoom = await request.get(`${API_BASE}/api/rooms/${room.id}`, {
    headers: { Authorization: `Bearer ${memberPayload.token}` },
  });
  expect(memberRoom.status()).toBe(403);
  expect((await memberRoom.json()).message).toMatch(/invite link/i);

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^access denied$/i })).toBeVisible();
  await expect(page.getByText("401")).toBeVisible();
  await expect(page.getByText(/invite link/i)).toBeVisible();
  const backButton = page.getByRole("button", { name: /^back$/i });
  await expect(backButton).toBeVisible();
  const backButtonBox = await backButton.boundingBox();
  const accessViewport = page.viewportSize();
  expect(backButtonBox).toBeTruthy();
  expect(accessViewport).toBeTruthy();
  expect(backButtonBox!.x + backButtonBox!.width / 2).toBeGreaterThan(accessViewport!.width * 0.42);
  expect(backButtonBox!.x + backButtonBox!.width / 2).toBeLessThan(accessViewport!.width * 0.58);
  await backButton.click();
  await expect(page.getByRole("button", { name: /create domain/i })).toBeVisible();
});

// Single-instance UAT: the newest room tab wins globally for an account. The
// older tab should not sit in the world with a dead socket; it must visibly
// move to a disconnected state with a clear way back to the dashboard.
test("UAT: newer world tab replaces the older active instance", async ({ context, page, request }) => {
  const userPayload = await registerViaApi(request, "Single Instance User", uniqueEmail("single-instance"));
  const { room: firstRoom } = await createRoomViaApi(request, userPayload.token, {
    name: "First Instance World",
    moduleCode: "CS2040S",
  });
  const { room: secondRoom } = await createRoomViaApi(request, userPayload.token, {
    name: "Second Instance World",
    moduleCode: "CS2100",
  });

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, userPayload.token);
  await page.goto(`/#/rooms/${firstRoom.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.diffriendtiateSocket?.connected)))
    .toBe(true);

  const newerPage = await context.newPage();
  await newerPage.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, userPayload.token);
  await newerPage.goto(`/#/rooms/${secondRoom.id}`);
  await expect(newerPage.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await expect
    .poll(() => newerPage.evaluate(() => Boolean(window.diffriendtiateSocket?.connected)))
    .toBe(true);

  await expect(page.getByRole("heading", { name: /^instance replaced$/i })).toBeVisible();
  await expect(page.getByText("Offline")).toBeVisible();
  await expect(page.getByText(/another tab or window/i)).toBeVisible();
  await page.getByRole("button", { name: /^back$/i }).click();
  await expect(page.getByRole("button", { name: /create domain/i })).toBeVisible();

  await newerPage.close();
});
