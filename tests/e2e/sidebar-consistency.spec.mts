import { expect, test } from "@playwright/test";
import { apiRequest, createRoom, expectStatus, registerUser } from "../helpers/apiClient.mts";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";

async function createChannel(roomId, token, name) {
  return expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${roomId}/channels`, {
      method: "POST",
      token,
      body: { name, type: "text" },
    }),
    201,
    `create ${name} channel`,
  );
}

async function updateChannelLayout(roomId, token, channelLayout) {
  return expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${roomId}/channel-layout`, {
      method: "PATCH",
      token,
      body: { channelLayout },
    }),
    200,
    "update channel layout",
  );
}

async function createResource(roomId, token, title = "StaticHazard.pdf", options = {}) {
  const payload = await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${roomId}/resources/url`, {
      method: "POST",
      token,
      body: {
        title,
        url: `https://example.com/${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
        ...options,
      },
    }),
    201,
    "create quick access resource",
  );
  return payload.resource;
}

async function sidebarStyle(page, selector) {
  // This browser-side style read protects the shared sidebar tokens from being
  // overridden by older tab-specific CSS rules with higher specificity.
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return null;
    const styles = window.getComputedStyle(element);

    return {
      borderRadius: styles.borderRadius,
      firstTags: Array.from(element.children).map((child) => child.tagName.toLowerCase()),
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      gap: styles.gap,
      minHeight: styles.minHeight,
      paddingLeft: styles.paddingLeft,
      paddingRight: styles.paddingRight,
    };
  }, selector);
}

async function verticalGap(page, firstSelector, secondSelector) {
  return page.evaluate(
    ({ firstSelector: topSelector, secondSelector: bottomSelector }) => {
      const first = document.querySelector(topSelector)?.getBoundingClientRect();
      const second = document.querySelector(bottomSelector)?.getBoundingClientRect();
      if (!first || !second) return null;
      return Math.round(second.top - first.bottom);
    },
    { firstSelector, secondSelector },
  );
}

async function leftDelta(page, firstSelector, secondSelector) {
  return page.evaluate(
    ({ firstSelector: aSelector, secondSelector: bSelector }) => {
      const first = document.querySelector(aSelector)?.getBoundingClientRect();
      const second = document.querySelector(bSelector)?.getBoundingClientRect();
      if (!first || !second) return null;
      return Math.round(Math.abs(first.left - second.left));
    },
    { firstSelector, secondSelector },
  );
}

async function resourceRowActionState(page, rowText) {
  return page.evaluate((targetText) => {
    const rows = Array.from(document.querySelectorAll(".resource-table-row:not(.folder)"));
    const row = rows.find((candidate) => candidate.textContent?.includes(targetText));
    const actions = row?.querySelector(".resource-row-actions");
    if (!actions) return null;
    const actionStyles = window.getComputedStyle(actions);
    const activeButton = actions.querySelector("button.active");
    const activeRect = activeButton?.getBoundingClientRect();
    const inactiveButtons = Array.from(actions.querySelectorAll("button:not(.active)")).map((button) => {
      const styles = window.getComputedStyle(button);
      return {
        display: styles.display,
        opacity: styles.opacity,
      };
    });

    return {
      activeStarLeft: activeRect ? Math.round(activeRect.left) : null,
      inactiveButtons,
      justifyContent: actionStyles.justifyContent,
      opacity: actionStyles.opacity,
      transitionDuration: actionStyles.transitionDuration,
    };
  }, rowText);
}

async function activeResourceStarLeft(page, rowText) {
  return page.evaluate((targetText) => {
    const rows = Array.from(document.querySelectorAll(".resource-table-row:not(.folder)"));
    const row = rows.find((candidate) => candidate.textContent?.includes(targetText));
    const button = row?.querySelector(".resource-row-actions button.active");
    if (!button) return null;
    return Math.round(button.getBoundingClientRect().left);
  }, rowText);
}

async function previewResourceRowActionMetrics(page, rowText) {
  return page.evaluate((targetText) => {
    const shell = document.querySelector(".resource-drive-shell");
    const rows = Array.from(document.querySelectorAll(".resource-table-row:not(.folder)"));
    const row = rows.find((candidate) => candidate.textContent?.includes(targetText));
    const actions = row?.querySelector(".resource-row-actions");
    if (!shell || !row || !actions) return null;

    const rowRect = row.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const rowStyles = window.getComputedStyle(row);

    return {
      actionRightInset: Math.round(rowRect.right - actionsRect.right),
      previewOpen: shell.classList.contains("preview-open"),
      rowBgStart: rowStyles.getPropertyValue("--resource-row-bg-start").trim(),
    };
  }, rowText);
}

test("room tab sidebars share row and collapsible section styling", async ({ page }) => {
  const owner = await registerUser(API_BASE, { name: "Sidebar Style Owner" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Sidebar Style QA",
    moduleCode: "CS2040S",
  });
  await createChannel(room.id, owner.token, "lectures");
  await updateChannelLayout(room.id, owner.token, [
    { id: "default-text-channels", name: "Channels", channels: ["general"] },
    { id: "section-notes", name: "Lecture Notes", channels: ["lectures"] },
  ]);
  const resource = await createResource(room.id, owner.token);
  await createResource(room.id, owner.token, "GlitchCheck.pdf");

  await page.addInitScript(({ token, roomId, resourceId }) => {
    localStorage.setItem("diffriendtiate_token", token);
    localStorage.setItem(`diffriendtiate:${roomId}:resourceStarredIds`, JSON.stringify([resourceId]));
    localStorage.setItem(`diffriendtiate:room:${roomId}:resourceFolders`, JSON.stringify(["Uploads/Test"]));
  }, { resourceId: resource.id, roomId: room.id, token: owner.token });

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();

  const sectionStyle = {
    borderRadius: "10px",
    fontSize: "13.76px",
    fontWeight: "850",
    gap: "7px",
    minHeight: "30px",
    paddingLeft: "6px",
    paddingRight: "6px",
  };
  const rowStyle = {
    borderRadius: "10px",
    fontSize: "15.04px",
    fontWeight: "720",
    gap: "9px",
    minHeight: "36px",
    paddingLeft: "10px",
    paddingRight: "10px",
  };
  const intelligrateHeadingStyle = {
    borderRadius: "10px",
    fontSize: "14.08px",
    fontWeight: "900",
    gap: "7px",
    minHeight: "30px",
    paddingLeft: "0px",
    paddingRight: "0px",
  };

  await expect
    .poll(() => sidebarStyle(page, ".limeets-sidebar-section-heading.toggle"))
    .toMatchObject({ ...sectionStyle, firstTags: ["svg", "span", "svg"] });

  await page.getByRole("button", { name: /^intelligrate$/i }).click();
  const recentsToggle = page.getByRole("button", { name: /^recents$/i });
  await expect(recentsToggle).toBeVisible();
  await expect
    .poll(() => sidebarStyle(page, ".buddy-recents-heading"))
    .toMatchObject({ ...intelligrateHeadingStyle, firstTags: ["svg", "span"] });
  await recentsToggle.click();
  await expect(page.locator(".recent-chat-list.chatgpt-style")).toHaveCount(0);
  await recentsToggle.click();

  await page.getByRole("button", { name: /^convolution$/i }).click();
  const addSectionButton = page.getByRole("button", { name: /^add section$/i });
  await expect(addSectionButton).toBeVisible();
  await addSectionButton.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect
    .poll(() => verticalGap(page, ".chat-drafts-link", ".chat-add-section-button"))
    .toBeLessThanOrEqual(6);
  await expect
    .poll(() => sidebarStyle(page, ".chat-add-section-button"))
    .toMatchObject({ ...rowStyle, firstTags: ["svg"] });
  await expect
    .poll(() => sidebarStyle(page, ".chat-category-toggle"))
    .toMatchObject({ ...sectionStyle, firstTags: ["svg", "span"] });

  await page.getByRole("button", { name: /^infilenite$/i }).click();
  const quickAccessToggle = page.getByRole("button", { name: /^quick access$/i });
  await expect(quickAccessToggle).toBeVisible();
  await expect
    .poll(() => sidebarStyle(page, ".resource-quick-heading"))
    .toMatchObject({ ...intelligrateHeadingStyle, firstTags: ["svg", "span"] });
  await expect
    .poll(() => leftDelta(page, ".resource-quick-heading span", ".resource-quick-section-title > svg:first-child"))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => leftDelta(page, ".resource-quick-section-title span", ".resource-quick-item-primary svg"))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => sidebarStyle(page, ".resource-quick-section-title"))
    .toMatchObject({ ...sectionStyle, firstTags: ["svg", "span"], paddingLeft: "0px" });
  await expect
    .poll(() => sidebarStyle(page, ".resource-sidebar-button"))
    .toMatchObject({ ...rowStyle, firstTags: ["svg"] });
  await quickAccessToggle.click();
  await expect(page.locator(".resource-quick-list")).toHaveCount(0);
  await quickAccessToggle.click();

  await page.locator(".resource-drive-table").getByRole("button", { name: "Uploads", exact: true }).click();
  await page.locator(".resource-drive-table").getByRole("button", { name: "Test", exact: true }).click();
  const breadcrumb = page.getByRole("navigation", { name: "Resource path" });
  await expect(breadcrumb).toContainText("All Files / Uploads / Test");
  await expect(breadcrumb).toHaveCSS("border-top-width", "1px");

  await page.getByRole("button", { name: "New Folder" }).click();
  const createFolderDialog = page.getByRole("dialog");
  await expect(createFolderDialog).toBeVisible();
  await expect(createFolderDialog.locator(".resource-folder-location")).toContainText(
    "LocationAll Files / Uploads / Test",
  );
  await expect(createFolderDialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await createFolderDialog.getByRole("button", { name: /close/i }).click();
  await expect(createFolderDialog).toBeHidden();
  await breadcrumb.getByRole("button", { name: "All Files" }).click();

  await page.locator(".resource-drive-table").getByRole("button", { name: "General", exact: true }).click();

  const unstarredRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "GlitchCheck.pdf" });
  await expect(unstarredRow).toBeVisible();
  await unstarredRow.hover();
  await expect.poll(() => resourceRowActionState(page, "GlitchCheck.pdf")).toMatchObject({
    justifyContent: "flex-end",
    opacity: "1",
  });
  await page.mouse.move(20, 20);
  await expect.poll(() => resourceRowActionState(page, "GlitchCheck.pdf")).toMatchObject({
    justifyContent: "flex-start",
    opacity: "0",
    transitionDuration: "0s",
  });

  const starredRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "StaticHazard.pdf" });
  await expect(starredRow).toBeVisible();

  const starLeftBeforeHover = await activeResourceStarLeft(page, "StaticHazard.pdf");
  await starredRow.hover();
  const starLeftDuringHover = await activeResourceStarLeft(page, "StaticHazard.pdf");
  await page.mouse.move(20, 20);
  await expect.poll(() => activeResourceStarLeft(page, "StaticHazard.pdf")).toBe(starLeftBeforeHover);
  expect(starLeftBeforeHover).not.toBe(starLeftDuringHover);

  await starredRow.locator(".resource-name-cell").click();
  await expect(page.locator(".resource-preview-panel")).toBeVisible();
  await starredRow.hover();
  await expect.poll(() => previewResourceRowActionMetrics(page, "StaticHazard.pdf")).toMatchObject({
    actionRightInset: 0,
    previewOpen: true,
    rowBgStart: "0px",
  });

  await page.getByRole("button", { name: /^coordidate$/i }).click();
  await expect(page.getByRole("button", { name: /^scheduled meetings$/i })).toBeVisible();
  await expect
    .poll(() => sidebarStyle(page, ".calendar-sidebar-heading"))
    .toMatchObject({ ...sectionStyle, firstTags: ["svg", "h3"] });
});

test("Infilenite supports multi-select download, move, and delete", async ({ page }) => {
  const owner = await registerUser(API_BASE, { name: "Infilenite Multi Owner" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Infilenite Multi QA",
    moduleCode: "CS2040S",
  });
  await createResource(room.id, owner.token, "Multi Alpha.pdf", { folder: "General" });
  await createResource(room.id, owner.token, "Multi Beta.txt", { folder: "General" });

  await page.addInitScript(({ roomId, token }) => {
    localStorage.setItem("diffriendtiate_token", token);
    localStorage.setItem(
      `diffriendtiate:room:${roomId}:resourceFolders`,
      JSON.stringify(["General/Selected Target"]),
    );
    (window as any).__resourceDownloadClicks = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function interceptedAnchorClick() {
      if (this.hasAttribute("download")) {
        (window as any).__resourceDownloadClicks.push(this.href);
        return;
      }
      return originalClick.call(this);
    };
  }, { roomId: room.id, token: owner.token });

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await page.getByRole("button", { name: /^infilenite$/i }).click();
  await page.locator(".resource-drive-table").getByRole("button", { name: "General", exact: true }).click();

  const alphaRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "Multi Alpha.pdf" });
  const betaRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "Multi Beta.txt" });
  await expect(alphaRow.locator(".resource-selection-cell")).toHaveCSS("opacity", "0");
  await alphaRow.hover();
  await expect(alphaRow.locator(".resource-selection-cell")).toHaveCSS("opacity", "1");
  await page.getByLabel("Select Multi Alpha.pdf").check();
  await expect(page.locator(".resource-drive-table")).toHaveClass(/selection-active/);
  await page.getByLabel("Select Multi Alpha.pdf").uncheck();
  await page.mouse.move(18, 18);
  await expect(page.locator(".resource-drive-table")).not.toHaveClass(/selection-active/);
  await expect(alphaRow.locator(".resource-selection-cell")).toHaveCSS("opacity", "0");
  await alphaRow.hover();
  await page.getByLabel("Select Multi Alpha.pdf").check();
  await expect(page.locator(".resource-drive-table")).toHaveClass(/selection-active/);
  await expect(betaRow.locator(".resource-selection-cell")).toHaveCSS("opacity", "1");
  await page.getByLabel("Select Multi Beta.txt").check();
  const bulkToolbar = page.getByRole("toolbar", { name: "Selected resource actions" });
  await expect(bulkToolbar).toContainText("2 Selected");
  await expect(bulkToolbar.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await bulkToolbar.getByRole("button", { name: "Download" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__resourceDownloadClicks?.length || 0))
    .toBe(2);

  await bulkToolbar.getByRole("button", { name: "Move" }).click();
  const moveDialog = page.getByRole("dialog");
  await expect(moveDialog.getByRole("heading", { name: "Move Selected Items" })).toBeVisible();
  await moveDialog.locator(".resource-move-row").filter({ hasText: "General" }).getByRole("button").first().click();
  await moveDialog
    .locator(".resource-move-row")
    .filter({ hasText: "Selected Target" })
    .getByRole("button")
    .first()
    .click();
  await moveDialog.getByRole("button", { name: "Move Here" }).click();

  await expect(bulkToolbar).toHaveCount(0);
  await page
    .locator(".resource-table-row.folder")
    .filter({ hasText: "Selected Target" })
    .getByRole("button")
    .first()
    .click();
  await expect(alphaRow).toBeVisible();
  await expect(betaRow).toBeVisible();

  await alphaRow.hover();
  await page.getByLabel("Select Multi Alpha.pdf").check();
  await page.getByLabel("Select Multi Beta.txt").check();
  await page.getByRole("toolbar", { name: "Selected resource actions" }).getByRole("button", { name: "Delete" }).click();
  await expect(alphaRow).toHaveCount(0);
  await page.getByRole("button", { name: /^deleted files$/i }).click();
  await expect(page.locator(".resource-table-row:not(.folder)").filter({ hasText: "Multi Alpha.pdf" })).toBeVisible();
  await expect(page.locator(".resource-table-row:not(.folder)").filter({ hasText: "Multi Beta.txt" })).toBeVisible();
});

test("Infilenite keeps Canvas sync folders read-only but accessible", async ({ page }) => {
  const owner = await registerUser(API_BASE, { name: "Canvas Sync Owner" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Canvas Sync QA",
    moduleCode: "CS2040S",
  });
  await createResource(room.id, owner.token, "Regular Notes.pdf", { folder: "General" });

  const canvasResource = {
    id: "res_canvas_sync_preview",
    roomId: room.id,
    uploaderId: owner.user?.id || owner.id || "",
    type: "url",
    title: "Canvas Plan.pdf",
    folder: "Canvas/Course Materials",
    url: "https://example.com/canvas-plan.pdf",
    fileUrl: "https://example.com/canvas-plan.pdf",
    metadata: {
      resourceType: "Lecture Notes",
      source: "canvas-file",
    },
    resourceType: "pdf",
    conversionStatus: "not-needed",
    size: 2048,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await page.route(`**/api/rooms/${room.id}/resources**`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    if (route.request().method() === "GET" && !route.request().url().includes("deleted=true")) {
      payload.resources = [...(payload.resources || []), canvasResource];
    }
    await route.fulfill({
      contentType: "application/json",
      status: response.status(),
      body: JSON.stringify(payload),
    });
  });

  await page.addInitScript(({ token }) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, { token: owner.token });

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await page.getByRole("button", { name: /^infilenite$/i }).click();

  const canvasFolder = page.locator(".resource-table-row.folder").filter({ hasText: "Canvas" });
  const generalFolder = page.locator(".resource-table-row.folder").filter({ hasText: "General" });
  await expect(canvasFolder).toBeVisible();
  await expect(generalFolder).toBeVisible();
  await expect(canvasFolder.getByRole("button", { name: /Canvas options/i })).toHaveCount(0);
  await expect(canvasFolder.locator(".resource-sync-badge")).toHaveCount(1);
  await expect(canvasFolder.locator(".resource-sync-badge")).toHaveCSS("border-top-width", "0px");
  const syncBadgeBackground = await canvasFolder
    .locator(".resource-sync-badge")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(syncBadgeBackground).not.toBe("rgba(0, 0, 0, 0)");
  await expect(canvasFolder).not.toContainText("Canvas Sync");

  await canvasFolder.hover();
  await page.getByLabel("Select Canvas").check();
  const bulkToolbar = page.getByRole("toolbar", { name: "Selected resource actions" });
  await expect(bulkToolbar.getByRole("button", { name: "Move" })).toBeDisabled();
  await expect(bulkToolbar.getByRole("button", { name: "Delete" })).toBeDisabled();
  await expect(bulkToolbar.getByRole("button", { name: "Download" })).toBeEnabled();
  await page.getByLabel("Select Canvas").uncheck();

  await canvasFolder.locator(".resource-name-cell").click();
  await expect(page.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Folder" })).toHaveCount(0);

  const courseFolder = page.locator(".resource-table-row.folder").filter({ hasText: "Course Materials" });
  await expect(courseFolder).toBeVisible();
  await expect(courseFolder.getByRole("button", { name: /Course Materials options/i })).toHaveCount(0);
  await courseFolder.locator(".resource-name-cell").click();

  const canvasFile = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "Canvas Plan.pdf" });
  await expect(canvasFile).toBeVisible();
  await expect(canvasFile.locator(".resource-sync-badge")).toHaveCount(1);
  await canvasFile.hover();
  await canvasFile.getByRole("button", { name: /Canvas Plan\.pdf options/i }).click();
  await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await canvasFile.locator(".resource-name-cell").click();
  await expect(page.locator(".resource-preview-panel").getByRole("heading", { name: "Canvas Plan.pdf" })).toBeVisible();
});

test("Infilenite supports drag-drop upload, preview, and resource edit actions", async ({ page }) => {
  const owner = await registerUser(API_BASE, { name: "Infilenite Upload Owner" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Infilenite Upload QA",
    moduleCode: "CS2040S",
  });

  await page.addInitScript(({ token }) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, { token: owner.token });

  await page.goto(`/#/rooms/${room.id}`);
  await expect(page.getByRole("heading", { name: /^domain$/i })).toBeVisible();
  await page.getByRole("button", { name: /^infilenite$/i }).click();

  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["Drag-drop upload content"], "DropNote.txt", { type: "text/plain" }));
    dataTransfer.items.add(
      new File(["Fake docx package for upload routing"], "DragUpload.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const target = document.querySelector(".resource-drive-main");
    target?.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    target?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(page.locator(".resource-drop-overlay")).toHaveCount(0);

  await page.locator(".resource-drive-table").getByRole("button", { name: "Uploads", exact: true }).click();
  const droppedRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "DropNote.txt" });
  await expect(droppedRow).toBeVisible();
  await expect(page.locator(".resource-table-row:not(.folder)").filter({ hasText: "DragUpload.docx" })).toBeVisible();

  await droppedRow.locator(".resource-name-cell").click();
  const previewPanel = page.locator(".resource-preview-panel");
  await expect(previewPanel.getByRole("heading", { name: "DropNote.txt" })).toBeVisible();
  await expect(previewPanel.getByRole("link", { name: "Open" })).toHaveCount(0);
  await expect(previewPanel.getByRole("link", { name: "Download" })).toHaveCount(0);
  await expect(previewPanel.locator(".resource-preview-body iframe")).toBeVisible();
  await expect(page.locator(".resource-table-head > :nth-child(4)")).toBeHidden();
  await previewPanel.getByRole("button", { name: "Close Preview" }).click();
  await expect(previewPanel).toHaveCount(0);

  await droppedRow.hover();
  await droppedRow.getByRole("button", { name: /DropNote\.txt options/i }).click();
  await expect(page.getByRole("menuitem", { name: "Preview" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Move", exact: true }).click();
  const moveDialog = page.getByRole("dialog");
  await expect(moveDialog.getByRole("heading", { name: "Move Resource" })).toBeVisible();
  await expect(moveDialog.getByPlaceholder("Search Folders")).toBeVisible();
  await expect(
    moveDialog.getByLabel("Move destination path").getByRole("button", { name: "All Files", exact: true }),
  ).toBeVisible();
  await expect(moveDialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await moveDialog.getByRole("button", { name: /close/i }).click();
  await expect(moveDialog).toBeHidden();

  await page.getByRole("button", { name: "New Folder" }).click();
  const folderDialog = page.getByRole("dialog");
  await folderDialog.getByPlaceholder("Folder Name").fill("Nested QA");
  await folderDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".resource-table-row.folder").filter({ hasText: "Nested QA" })).toBeVisible();

  await droppedRow.hover();
  await droppedRow.getByRole("button", { name: /DropNote\.txt options/i }).click();
  await page.getByRole("menuitem", { name: "Move", exact: true }).click();
  const nestedMoveDialog = page.getByRole("dialog");
  await nestedMoveDialog.locator(".resource-move-row").filter({ hasText: "Uploads" }).getByRole("button").first().click();
  await nestedMoveDialog.locator(".resource-move-row").filter({ hasText: "Nested QA" }).getByRole("button").first().click();
  await expect(nestedMoveDialog.locator(".resource-picker-node")).toHaveCount(2);
  await expect(nestedMoveDialog.locator(".resource-picker-separator")).toHaveCount(2);
  await nestedMoveDialog.getByRole("button", { name: "Move Here" }).click();

  await page.locator(".resource-table-row.folder").filter({ hasText: "Nested QA" }).getByRole("button").first().click();
  const nestedDroppedRow = page.locator(".resource-table-row:not(.folder)").filter({ hasText: "DropNote.txt" });
  await expect(nestedDroppedRow).toBeVisible();
  const uploadsCrumb = page.locator(".resource-breadcrumb").getByRole("button", { name: "Uploads", exact: true });
  await nestedDroppedRow.dragTo(uploadsCrumb);
  await expect(page.locator(".resource-drop-overlay")).toHaveCount(0);
  await uploadsCrumb.click();
  await expect(droppedRow).toBeVisible();

  await droppedRow.hover();
  await droppedRow.getByRole("button", { name: /DropNote\.txt options/i }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByRole("heading", { name: "Edit Resource" })).toBeVisible();
  await expect(editDialog.locator("select")).toHaveCount(0);
  const categoryDropdown = editDialog.getByLabel("Category");
  await expect(categoryDropdown).toBeVisible();
  await categoryDropdown.click();
  await expect(editDialog.locator(".app-select-option-list")).toBeVisible();
  await expect(editDialog.getByRole("option", { name: "Reference" })).toBeVisible();
  await editDialog.getByRole("option", { name: "Reference" }).click();
  await expect(editDialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await editDialog.getByRole("button", { name: /close/i }).click();
  await expect(editDialog).toBeHidden();

  await droppedRow.hover();
  await droppedRow.getByRole("button", { name: /DropNote\.txt options/i }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: /^deleted files$/i }).click();
  await expect(page.locator(".resource-drive-table.deleted-view .resource-table-head")).not.toContainText("Date Modified");
  await expect(page.locator(".resource-table-row:not(.folder)").filter({ hasText: "DropNote.txt" })).toBeVisible();
});
