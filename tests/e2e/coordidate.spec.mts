import { expect, test, type Locator } from "@playwright/test";
import {
  apiRequest,
  createRoom,
  expectStatus,
  joinRoom,
  registerUser,
} from "../helpers/apiClient.mts";

const API_BASE = process.env.E2E_API_BASE || "http://127.0.0.1:4011";

function sgIso(date, time) {
  return `${date}T${time}:00+08:00`;
}

function relativeIso(offsetMinutes) {
  return new Date(Date.now() + offsetMinutes * 60 * 1000).toISOString();
}

function monthIndex(value: Date) {
  return value.getFullYear() * 12 + value.getMonth();
}

function parseMonthTitle(value: string) {
  const parsed = new Date(`${value} 1`);
  return Number.isNaN(parsed.getTime()) ? null : monthIndex(parsed);
}

async function chooseDateFromOpenPicker(datePopover: Locator, dateKey: string) {
  const target = new Date(`${dateKey}T00:00:00+08:00`);
  const targetMonthIndex = monthIndex(target);
  const targetMonthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(target);

  for (let attempts = 0; attempts < 36; attempts += 1) {
    const currentTitle = (await datePopover.locator("header strong").innerText()).trim();
    if (currentTitle === targetMonthTitle) break;

    const currentMonthIndex = parseMonthTitle(currentTitle);
    if (currentMonthIndex == null) {
      throw new Error(`Unable to parse Coordidate date picker month: ${currentTitle}`);
    }

    await datePopover
      .getByRole("button", { name: currentMonthIndex > targetMonthIndex ? /^previous month$/i : /^next month$/i })
      .click();
  }

  await expect(datePopover.locator("header strong")).toHaveText(targetMonthTitle);
  await datePopover
    .locator(".coordinate-date-grid button:not(.muted)", { hasText: new RegExp(`^${target.getDate()}$`) })
    .click();
}

async function seedSession(roomId, token, body) {
  const result = await apiRequest(API_BASE, `/api/rooms/${roomId}/sessions`, {
    method: "POST",
    token,
    body,
  });
  return expectStatus(result, 201, `create ${body.title}`);
}

test("Coordidate keeps calendar and availability interactions polished", async ({ browser, page }) => {
  // Seed a real owner/member room through the public API so the browser test
  // can focus on Coordidate UI behavior instead of repeating auth setup clicks.
  const owner = await registerUser(API_BASE, { name: "Coordidate Owner" });
  const member = await registerUser(API_BASE, { name: "Coordidate Member" });
  const room = await createRoom(API_BASE, owner.token, {
    name: "Coordidate QA Room",
    moduleCode: "CS2103T",
    worldConfig: {
      enabled: true,
      version: 2,
      tileSize: 32,
      columns: 24,
      rows: 18,
      activeRoomId: "custom-world",
      spawnpoint: { roomId: "custom-world", x: 2, y: 2 },
      rooms: [
        {
          id: "custom-world",
          name: "World",
          columns: 24,
          rows: 18,
          tilemap: {},
        },
      ],
      privateAreas: [
        {
          id: "area-scara",
          name: "Scara",
          roomId: "custom-world",
          bounds: { col: 6, row: 5, width: 4, height: 3 },
          effects: { meeting: true },
        },
      ],
    },
  });
  await joinRoom(API_BASE, member.token, room.id);

  const pollPayload = await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/coordinate/poll`, {
      method: "PUT",
      token: owner.token,
      body: {
        title: "Project Meeting",
        rangeStart: sgIso("2026-07-04", "09:00"),
        rangeEnd: sgIso("2026-07-12", "17:00"),
        slotMinutes: 30,
        dayStartMinutes: 9 * 60,
        dayEndMinutes: 17 * 60,
        selectedDates: ["2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08"],
        timezone: "Asia/Singapore",
      },
    }),
    200,
    "create coordinate poll",
  );
  const poll = pollPayload.polls.find((candidate) => candidate.title === "Project Meeting");

  await expectStatus(
    await apiRequest(API_BASE, `/api/rooms/${room.id}/coordinate/availability`, {
      method: "PUT",
      token: member.token,
      body: {
        pollId: poll.id,
        slots: [
          {
            startAt: sgIso("2026-07-04", "09:00"),
            endAt: sgIso("2026-07-04", "09:30"),
            status: "available",
          },
        ],
      },
    }),
    200,
    "seed member availability",
  );

  await seedSession(room.id, owner.token, {
    title: "All Day Workshop",
    kind: "event",
    color: "green",
    allDay: true,
    startsAt: sgIso("2026-07-04", "00:00"),
    endsAt: sgIso("2026-07-04", "23:59"),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Focus Review",
    kind: "event",
    color: "rose",
    startsAt: sgIso("2026-07-04", "05:00"),
    endsAt: sgIso("2026-07-04", "06:00"),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Pair Check-In",
    kind: "meeting",
    color: "iris",
    startsAt: sgIso("2026-07-04", "05:30"),
    endsAt: sgIso("2026-07-04", "06:30"),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Submit Draft",
    kind: "deadline",
    color: "gold",
    startsAt: sgIso("2026-07-04", "09:00"),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Half Hour Meetup",
    kind: "meeting",
    color: "iris",
    startsAt: sgIso("2026-07-04", "13:00"),
    endsAt: sgIso("2026-07-04", "13:30"),
    location: "Scara",
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Live World Meetup",
    kind: "meeting",
    color: "green",
    startsAt: relativeIso(-15),
    endsAt: relativeIso(45),
    location: "Scara",
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Soon Deadline",
    kind: "deadline",
    color: "gold",
    startsAt: relativeIso(30),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Past Sidebar Meeting",
    kind: "meeting",
    color: "rose",
    startsAt: relativeIso(-120),
    endsAt: relativeIso(-90),
    visibility: "room",
  });
  await seedSession(room.id, owner.token, {
    title: "Past Sidebar Deadline",
    kind: "deadline",
    color: "gold",
    startsAt: relativeIso(-15),
    visibility: "room",
  });

  await page.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, owner.token);

  await page.goto(`/#/rooms/${room.id}`);
  await page.getByRole("button", { name: /^coordidate$/i }).click();
  await expect(page.locator(".coordinate-calendar-product")).toBeVisible();

  const memberPage = await browser.newPage();
  await memberPage.addInitScript((token) => {
    localStorage.setItem("diffriendtiate_token", token);
  }, member.token);
  await memberPage.goto(`${new URL(page.url()).origin}/#/rooms/${room.id}`);
  await memberPage.getByRole("button", { name: /^coordidate$/i }).click();
  await expect(memberPage.locator(".coordinate-calendar-product")).toBeVisible();
  await memberPage.getByRole("button", { name: /^availability$/i }).click();
  await expect(memberPage.locator(".coordinate-window-list-panel")).toBeVisible();
  await expect
    .poll(() => memberPage.evaluate(() => Boolean((window as any).diffriendtiateSocket?.connected)))
    .toBe(true);

  const realtimePoll = await apiRequest(API_BASE, `/api/rooms/${room.id}/coordinate/poll`, {
    method: "PUT",
    token: owner.token,
    body: {
      title: "Realtime Planning",
      rangeStart: sgIso("2026-07-11", "09:00"),
      rangeEnd: sgIso("2026-07-12", "17:00"),
      dayStartMinutes: 9 * 60,
      dayEndMinutes: 17 * 60,
      slotMinutes: 60,
      selectedDates: ["2026-07-11", "2026-07-12"],
    },
  });
  expect(realtimePoll.status).toBe(200);
  await expect(memberPage.locator(".coordinate-window-list").getByText("Realtime Planning")).toBeVisible();

  const liveSidebarCard = page.locator(".mini-session-card.ongoing.joinable", { hasText: "Live World Meetup" });
  await expect(liveSidebarCard).toBeVisible();
  await expect(liveSidebarCard).toContainText("Ongoing");
  await expect(liveSidebarCard).toContainText("Join In Domain");
  await expect(page.locator(".mini-session-card.deadline.soon", { hasText: "Soon Deadline" })).toBeVisible();
  await expect(page.locator(".mini-session-list").getByText("Past Sidebar Meeting")).toHaveCount(0);
  await expect(page.locator(".mini-session-list").getByText("Past Sidebar Deadline")).toHaveCount(0);

  await liveSidebarCard.click();
  await expect(page.locator(".study-space-content-panel")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((roomId) => {
        const saved = JSON.parse(localStorage.getItem(`diffriendtiate:room:${roomId}:limeets-gather-player`) || "{}");
        return `${saved.worldRoomId}:${saved.x}:${saved.y}`;
      }, room.id),
    )
    .toBe("custom-world:272:208");
  await page.getByRole("button", { name: /^coordidate$/i }).click();
  await expect(page.locator(".coordinate-calendar-product")).toBeVisible();

  // Day/week grids should have simple one-hour labels and half-hour click
  // targets, avoiding the blank stretched rows that previously hid content.
  await page.getByRole("button", { name: /^week$/i }).click();
  const todayButton = page.getByRole("button", { name: /^today$/i }).first();
  const newItemButton = page.getByRole("button", { name: /new item/i });
  const todayBox = await todayButton.boundingBox();
  const newItemBox = await newItemButton.boundingBox();
  expect(Math.abs((todayBox?.height || 0) - (newItemBox?.height || 0))).toBeLessThanOrEqual(1);

  await page.locator(".coordinate-date-button").click();
  const datePopover = page.locator(".coordinate-date-popover");
  await expect(datePopover).toBeVisible();
  await expect
    .poll(() => datePopover.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toBe("none");
  await chooseDateFromOpenPicker(datePopover, "2026-07-04");

  const timeLabels = await page
    .locator(".coordinate-heatmap-grid.calendar-mode .coordinate-grid-time")
    .allTextContents();
  expect(timeLabels.map((label) => label.trim())).toContain("12 AM");
  expect(timeLabels.map((label) => label.trim())).toContain("11 PM");
  expect(timeLabels.slice(1).every((label) => label.trim().length > 0)).toBe(true);
  await expect(page.locator(".coordinate-calendar-slot-zone").first()).toBeVisible();
  const hourSlotBox = await page.locator(".coordinate-calendar-slot.hour").first().boundingBox();
  expect(hourSlotBox?.height || 0).toBeGreaterThanOrEqual(60);
  expect(hourSlotBox?.height || 0).toBeLessThanOrEqual(70);
  await expect
    .poll(() => page.locator(".coordinate-calendar-slot.hour").first().evaluate((element) => getComputedStyle(element).borderBottomStyle))
    .toBe("solid");
  await expect
    .poll(() => page.locator(".coordinate-calendar-slot-zone").first().evaluate((element) => getComputedStyle(element).borderBottomStyle))
    .toBe("dashed");
  const calendarTimes = page.locator(".coordinate-heatmap-grid.calendar-mode .coordinate-grid-time");
  const midnightBox = await calendarTimes.nth(1).boundingBox();
  const oneAmBox = await calendarTimes.nth(2).boundingBox();
  const twoAmBox = await calendarTimes.nth(3).boundingBox();
  expect(Math.abs(((oneAmBox?.y || 0) - (midnightBox?.y || 0)) - 64)).toBeLessThanOrEqual(2);
  expect(Math.abs(((twoAmBox?.y || 0) - (oneAmBox?.y || 0)) - 64)).toBeLessThanOrEqual(2);

  const eventBlock = page.locator(".coordinate-event-block:has-text('Focus Review')").first();
  await expect(eventBlock).toBeVisible();
  const eventBox = await eventBlock.boundingBox();
  expect(eventBox?.height || 0).toBeGreaterThan(40);
  const halfHourBlock = page.locator(".coordinate-event-block.timed.compact", { hasText: "Half Hour Meetup" }).first();
  await expect(halfHourBlock).toBeAttached();
  await halfHourBlock.scrollIntoViewIfNeeded();
  const halfHourBox = await halfHourBlock.boundingBox();
  expect(halfHourBox?.height || 0).toBeLessThanOrEqual(34);
  await expect
    .poll(() => halfHourBlock.evaluate((element) => getComputedStyle(element).whiteSpace))
    .toBe("nowrap");

  const calendarHeader = page.locator(".coordinate-heatmap-grid.calendar-mode .coordinate-grid-day").first();
  const timedEventLayer = page.locator(".coordinate-timed-event-layer").first();
  await expect(calendarHeader).toBeVisible();
  const headerLayer = await calendarHeader.evaluate((element) => {
    const style = getComputedStyle(element);
    const color = style.backgroundColor;
    const rgbaParts = color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(",") || [];
    return {
      alpha: color.startsWith("rgba") ? Number(rgbaParts[3]?.trim() || 1) : 1,
      zIndex: Number.parseInt(style.zIndex || "0", 10) || 0,
    };
  });
  const timedLayerZIndex = await timedEventLayer.evaluate((element) => (
    Number.parseInt(getComputedStyle(element).zIndex || "0", 10) || 0
  ));
  const headerBackplate = await calendarHeader.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    const color = style.backgroundColor;
    const rgbaParts = color.match(/rgba?\(([^)]+)\)/)?.[1]?.split(",") || [];
    return {
      alpha: color.startsWith("rgba") ? Number(rgbaParts[3]?.trim() || 1) : 1,
      top: Number.parseFloat(style.top || "0") || 0,
      zIndex: Number.parseInt(style.zIndex || "0", 10) || 0,
    };
  });
  expect(headerLayer.alpha).toBe(1);
  expect(headerLayer.zIndex).toBeGreaterThan(timedLayerZIndex);
  expect(headerBackplate.alpha).toBe(1);
  expect(headerBackplate.top).toBeLessThan(0);

  const deadlineBlock = page.locator(".coordinate-event-block.deadline:has-text('Submit Draft')").first();
  await expect(deadlineBlock).toBeVisible();
  const deadlineBox = await deadlineBlock.boundingBox();
  expect(deadlineBox?.height || 0).toBeGreaterThan(26);
  expect(deadlineBox?.height || 0).toBeLessThan(46);
  await expect(page.locator(".coordinate-event-block button[aria-label='Delete event']")).toHaveCount(0);

  await page.getByRole("button", { name: /^month$/i }).click();
  await expect(page.locator(".coordinate-month-grid")).toBeVisible();
  const monthCellBoxes = await page.locator(".coordinate-month-grid > [role='button']").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, top: rect.top };
    }),
  );
  expect(monthCellBoxes).toHaveLength(42);
  for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
    const rowHeights = monthCellBoxes.slice(rowIndex * 7, rowIndex * 7 + 7).map((box) => box.height);
    expect(Math.max(...rowHeights) - Math.min(...rowHeights)).toBeLessThanOrEqual(1);
  }
  const monthRowHeights = Array.from({ length: 6 }, (_, rowIndex) => monthCellBoxes[rowIndex * 7].height);
  expect(Math.max(...monthRowHeights) - Math.min(...monthRowHeights)).toBeLessThanOrEqual(1);
  const moreItemsButton = page.locator(".coordinate-month-more-button").first();
  await expect(moreItemsButton).toBeVisible();
  await expect(moreItemsButton).toHaveText(/\+\d+ More/);
  const busyMonthCell = moreItemsButton.locator("xpath=ancestor::*[@role='button'][1]");
  await expect(busyMonthCell.locator("article")).toHaveCount(2);
  await moreItemsButton.click();
  const monthMorePopover = page.locator(".coordinate-month-more-popover");
  await expect(monthMorePopover).toBeVisible();
  await expect(monthMorePopover).toContainText("Half Hour Meetup");
  await monthMorePopover.getByRole("button", { name: /close month items/i }).click();
  await expect(monthMorePopover).toBeHidden();
  await page.getByRole("button", { name: /^week$/i }).click();
  await expect(page.locator(".coordinate-calendar-slot-zone").first()).toBeVisible();

  // The event form should treat deadlines as time-only items and expose colour
  // choices without meeting-specific location fields.
  await page.getByRole("button", { name: /new item/i }).click();
  const eventDialog = page.locator(".coordinate-event-dialog").last();
  await expect(eventDialog).toBeVisible();
  await eventDialog.getByRole("button", { name: /^deadline$/i }).click();
  await expect(eventDialog.getByText(/^All Day$/)).toHaveCount(0);
  await expect(eventDialog.getByText(/^Ends$/)).toHaveCount(0);
  await expect(eventDialog.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
  await expect(eventDialog.locator(".coordinate-color-options")).toBeVisible();
  await expect(eventDialog.locator(".coordinate-location-input")).toHaveCount(0);
  await eventDialog.getByRole("button", { name: /close new calendar item/i }).click();

  await page.getByLabel(/Create Item At 4 Jul, 10 AM/i).click();
  const slotDialog = page.locator(".coordinate-event-dialog").last();
  await expect(slotDialog.locator("input[name='startsAt']")).toHaveValue("2026-07-04T10:00");
  await expect(slotDialog.locator("input[name='endsAt']")).toHaveValue("2026-07-04T10:30");
  await slotDialog.getByRole("button", { name: /close new calendar item/i }).click();

  await page.getByRole("button", { name: /new item/i }).click();
  const manualDialog = page.locator(".coordinate-event-dialog").last();
  await manualDialog.locator("input[name='title']").fill("Manual Button Item");
  await manualDialog.locator("input[name='startsAt']").fill("2026-07-04T10:30");
  await manualDialog.locator("input[name='endsAt']").fill("2026-07-04T11:30");
  const expectedManualStart = await page.evaluate(() => new Date("2026-07-04T10:30").toISOString());
  const expectedManualEnd = await page.evaluate(() => new Date("2026-07-04T11:30").toISOString());
  const manualSessionRequest = page.waitForRequest((request) => (
    request.method() === "POST" &&
    request.url().includes(`/api/rooms/${room.id}/sessions`) &&
    (request.postData() || "").includes("Manual Button Item")
  ));
  await manualDialog.getByRole("button", { name: /^save$/i }).click();
  const manualSessionBody = (await manualSessionRequest).postDataJSON();
  expect(manualSessionBody.startsAt).toBe(expectedManualStart);
  expect(manualSessionBody.endsAt).toBe(expectedManualEnd);
  expect(manualSessionBody.startsAt).toMatch(/Z$/);
  await expect(manualDialog).toBeHidden();
  await page.locator(".coordinate-date-button").click();
  await chooseDateFromOpenPicker(page.locator(".coordinate-date-popover"), "2026-07-04");
  await expect(page.locator(".coordinate-event-block:has-text('Manual Button Item')")).toBeVisible();

  await page.getByRole("button", { name: /^availability$/i }).click();
  await expect(page.getByText("Project Meeting |")).toHaveCount(0);
  const availableBestSlot = page.locator(".coordinate-heat-slot").first();
  await expect(availableBestSlot).toBeVisible();
  const bestDecoration = await availableBestSlot.evaluate((element) => {
    element.classList.add("best");
    const content = getComputedStyle(element, "::after").content;
    element.classList.remove("best");
    return content;
  });
  expect(bestDecoration).toBe("none");
  await expect(page.getByText("29 Jun – 5 Jul")).toBeVisible();
  await expect(page.locator(".coordinate-availability-header").getByText("4 Jul – 12 Jul, 9 AM – 5 PM")).toBeVisible();
  const windowListPanel = page.locator(".coordinate-window-list-panel");
  await expect(windowListPanel).toBeVisible();
  const newWindowButton = windowListPanel.locator(".coordinate-new-window-button");
  await expect
    .poll(() =>
      windowListPanel.evaluate((panel) => {
        const button = panel.querySelector(".coordinate-new-window-button");
        if (!button) return false;
        const styles = getComputedStyle(panel);
        const contentWidth = panel.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
        return Math.abs(button.getBoundingClientRect().width - contentWidth) <= 3;
      }),
    )
    .toBe(true);
  await expect(page.locator(".coordinate-window-detail-summary")).toHaveCount(0);
  await expect(page.locator(".coordinate-respondent-list")).toHaveCount(0);
  await windowListPanel.locator(".coordinate-window-select").first().click();
  await expect(page.locator(".coordinate-window-detail-summary")).toBeVisible();
  await expect(page.locator(".coordinate-respondent-list")).toBeVisible();
  await expect(page.locator(".coordinate-window-detail-title em")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".coordinate-inspector.detail-mode .coordinate-window-detail-summary")
        .evaluate((element) => getComputedStyle(element).borderStyle),
    )
    .toBe("none");
  await page.getByRole("button", { name: /^back$/i }).click();
  await expect(windowListPanel).toBeVisible();
  await expect(page.locator(".coordinate-respondent-list")).toHaveCount(0);

  // Editing availability is a draft action: Cancel must restore the original
  // response rather than leaving newly painted cells in the UI.
  const firstHeatSlot = page.locator(".coordinate-heat-slot[data-slot-start]").first();
  await firstHeatSlot.hover();
  await expect(page.locator(".coordinate-slot-tooltip")).toBeVisible();
  await expect(page.locator(".coordinate-hover-summary")).toHaveCount(0);
  const neutralHoverOutline = await firstHeatSlot.evaluate((element) => getComputedStyle(element).outlineColor);
  await page.getByRole("button", { name: /^edit availability$/i }).click();
  await expect(page.locator(".coordinate-paint-toggle")).toHaveCount(0);
  await expect(page.getByText("Group Heatmap")).toHaveCount(0);
  await page.getByRole("button", { name: /availability colour help/i }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Available");
  await expect(page.getByRole("tooltip")).toContainText("If Needed");
  await expect(page.getByRole("tooltip")).toContainText("Right-click erases.");
  await expect(page.locator(".coordinate-availability-help-content em span")).toHaveCount(2);
  await expect
    .poll(() => page.locator(".coordinate-availability-help-content em").evaluate((element) => getComputedStyle(element).display))
    .toBe("grid");
  const availabilityLegendStyles = await page
    .locator(".field-tooltip.coordinate-availability-tooltip .availability-legend-row.available")
    .evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      borderLeftStyle: getComputedStyle(element).borderLeftStyle,
      borderLeftColor: getComputedStyle(element).borderLeftColor,
    }));
  expect(availabilityLegendStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(availabilityLegendStyles.borderLeftStyle).toBe("solid");
  expect(availabilityLegendStyles.borderLeftColor).not.toBe("rgba(0, 0, 0, 0)");
  await firstHeatSlot.hover();
  const editingHoverOutline = await firstHeatSlot.evaluate((element) => getComputedStyle(element).outlineColor);
  expect(neutralHoverOutline).not.toBe(editingHoverOutline);
  const unavailableSlot = page.locator(".coordinate-heatmap-grid.editing .coordinate-grid-gap").first();
  await expect(unavailableSlot).toBeVisible();
  const unavailableSlotStyles = await unavailableSlot.evaluate((element) => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    opacity: getComputedStyle(element).opacity,
  }));
  const selectableSlotBackground = await firstHeatSlot.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(unavailableSlotStyles.opacity).toBe("1");
  expect(unavailableSlotStyles.backgroundImage).not.toBe("none");
  expect(unavailableSlotStyles.backgroundImage).not.toBe(selectableSlotBackground);
  await firstHeatSlot.click();
  await expect(firstHeatSlot).toHaveClass(/own-available/);
  await expect(firstHeatSlot.locator(".coordinate-own-slot-marker.available")).toHaveCount(0);
  const availableDraftBackground = await firstHeatSlot.evaluate((element) => getComputedStyle(element).backgroundImage);
  await firstHeatSlot.click();
  await expect(firstHeatSlot).toHaveClass(/own-ifNeeded/);
  await expect(firstHeatSlot.locator(".coordinate-own-slot-marker.ifNeeded")).toHaveCount(0);
  const ifNeededDraftBackground = await firstHeatSlot.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(ifNeededDraftBackground).not.toBe(availableDraftBackground);
  await firstHeatSlot.click({ button: "right" });
  await expect(firstHeatSlot).not.toHaveClass(/own-/);
  await firstHeatSlot.click();
  await expect(firstHeatSlot).toHaveClass(/own-available/);
  await page.getByRole("button", { name: /^cancel$/i }).click();
  await expect(firstHeatSlot).not.toHaveClass(/own-available/);
  await page.getByRole("button", { name: /^edit availability$/i }).click();
  await firstHeatSlot.click();
  const saveAvailabilityRequest = page.waitForRequest((request) => (
    request.method() === "PUT" &&
    request.url().includes(`/api/rooms/${room.id}/coordinate/availability`) &&
    (request.postData() || "").includes(poll.id)
  ));
  await page.getByRole("button", { name: /^save$/i }).click();
  await saveAvailabilityRequest;
  const savedOwnMarker = firstHeatSlot.locator(".coordinate-own-slot-marker.available");
  await expect(savedOwnMarker).toBeVisible();
  const savedOwnMarkerStyles = await savedOwnMarker.evaluate((element) => ({
    afterContent: getComputedStyle(element, "::after").content,
    borderColors: (() => {
      const originalClasses = element.className;
      const available = getComputedStyle(element).borderColor;
      element.classList.remove("available");
      const neutral = getComputedStyle(element).borderColor;
      element.classList.add("ifNeeded");
      const ifNeeded = getComputedStyle(element).borderColor;
      element.className = originalClasses;
      return { available, ifNeeded, neutral };
    })(),
    borderStyle: getComputedStyle(element).borderStyle,
    childOpacity: Number(getComputedStyle(element.querySelector("img, span") || element).opacity),
    opacity: Number(getComputedStyle(element).opacity),
  }));
  expect(savedOwnMarkerStyles.afterContent).toBe("none");
  expect(savedOwnMarkerStyles.borderColors.available).not.toBe(savedOwnMarkerStyles.borderColors.neutral);
  expect(savedOwnMarkerStyles.borderColors.ifNeeded).not.toBe(savedOwnMarkerStyles.borderColors.available);
  expect(savedOwnMarkerStyles.borderStyle).toBe("solid");
  expect(savedOwnMarkerStyles.opacity).toBe(1);
  expect(savedOwnMarkerStyles.childOpacity).toBeLessThan(1);
  await expect(memberPage.locator(".coordinate-window-list article", { hasText: "Project Meeting" })).toContainText(
    "2/2 Responses",
  );

  const responsesHeading = page.locator(".coordinate-inspector-heading", { hasText: "Responses" }).first();
  const selectAll = responsesHeading.getByRole("checkbox", { name: /deselect all responses/i });
  await expect(selectAll).toBeVisible();
  await expect(selectAll).toBeChecked();
  await expect(page.locator(".coordinate-select-all-toggle")).toHaveCount(0);
  await selectAll.click();
  await expect(responsesHeading.getByRole("checkbox", { name: /select all responses/i })).not.toBeChecked();
  const bestTimesHeading = page.locator(".coordinate-inspector-heading", { hasText: "Best Times" }).first();
  await expect(bestTimesHeading.getByRole("checkbox", { name: /show best times/i })).toBeVisible();
  await expect(page.locator(".coordinate-availability-toggle-section", { hasText: "Show Best Times" })).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".coordinate-respondent-list button")
        .last()
        .evaluate((element) => getComputedStyle(element).borderBottomStyle),
    )
    .toBe("none");
  const firstRespondent = page.locator(".coordinate-respondent-list button").first();
  const respondentIdleBackground = await firstRespondent.evaluate((element) => getComputedStyle(element).backgroundColor);
  await firstRespondent.hover();
  await expect
    .poll(() => firstRespondent.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(respondentIdleBackground);
  await expect(page.locator(".coordinate-window-detail-title small").first()).toContainText(",");
  await expect(page.locator(".coordinate-window-detail-title small").first()).not.toContainText("·");
  await expect
    .poll(() => page.locator(".coordinate-window-detail-title small").first().evaluate((element) => getComputedStyle(element).whiteSpace))
    .toBe("nowrap");
  await expect
    .poll(() =>
      page.locator(".coordinate-window-detail-title small").first().evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await expect
    .poll(() => page.locator(".coordinate-respondent-list button.responded svg").first().evaluate((element) => getComputedStyle(element).color))
    .not.toBe("rgb(56, 168, 111)");
  const editWindowButton = page.locator(".coordinate-window-edit-button").first();
  await expect
    .poll(() => editWindowButton.evaluate((element) => getComputedStyle(element).borderStyle))
    .toBe("none");

  await editWindowButton.click();
  const editWindowDialog = page.locator(".coordinate-window-dialog");
  await expect(editWindowDialog).toBeVisible();
  await expect(editWindowDialog.getByText("5 Dates Selected")).toBeVisible();
  await expect(editWindowDialog.locator(".coordinate-date-grid.selectable button.selected")).toHaveCount(5);
  const saveWindowRequest = page.waitForRequest((request) => (
    request.method() === "PUT" &&
    request.url().includes(`/api/rooms/${room.id}/coordinate/poll`) &&
    (request.postData() || "").includes(poll.id)
  ));
  await editWindowDialog.getByRole("button", { name: /^save$/i }).click();
  const saveWindowBody = (await saveWindowRequest).postDataJSON();
  expect(saveWindowBody.selectedDates).toEqual([
    "2026-07-04",
    "2026-07-05",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
  ]);
  await expect(editWindowDialog).toBeHidden();

  await page.getByRole("button", { name: /^back$/i }).click();
  await page.getByRole("button", { name: /new window/i }).click();
  const windowDialog = page.locator(".coordinate-window-dialog");
  await expect(windowDialog).toBeVisible();
  await expect(windowDialog.getByText(/^From$/)).toHaveCount(0);
  await expect(windowDialog.getByText(/^To$/)).toHaveCount(0);
  await expect(windowDialog.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
  await expect(windowDialog.getByRole("button", { name: /^create window$/i })).toBeVisible();
  await windowDialog.getByRole("button", { name: /^close new meetup window$/i }).click();
  await expect(windowDialog).toBeHidden();
  await page.getByRole("button", { name: /new item/i }).click();
  const finalEventDialog = page.locator(".coordinate-event-dialog").last();
  await expect(finalEventDialog).toBeVisible();
  const eventSaveButton = finalEventDialog.getByRole("button", { name: /^save$/i });
  await expect
    .poll(() =>
      eventSaveButton.evaluate((element) => {
        const parent = element.parentElement;
        if (!parent) return false;
        const parentStyles = window.getComputedStyle(parent);
        const parentContentWidth =
          parent.getBoundingClientRect().width -
          Number.parseFloat(parentStyles.paddingLeft) -
          Number.parseFloat(parentStyles.paddingRight);
        return Math.abs(element.getBoundingClientRect().width - parentContentWidth) <= 2;
      }),
    )
    .toBe(true);
  await memberPage.close();
});
