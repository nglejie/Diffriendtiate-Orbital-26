import { expect, test } from "@playwright/test";
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

async function seedSession(roomId, token, body) {
  const result = await apiRequest(API_BASE, `/api/rooms/${roomId}/sessions`, {
    method: "POST",
    token,
    body,
  });
  return expectStatus(result, 201, `create ${body.title}`);
}

test("Coordidate keeps calendar and availability interactions polished", async ({ page }) => {
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

  const liveSidebarCard = page.locator(".mini-session-card.ongoing.joinable", { hasText: "Live World Meetup" });
  await expect(liveSidebarCard).toBeVisible();
  await expect(liveSidebarCard).toContainText("Ongoing");
  await expect(liveSidebarCard).toContainText("Join In World");
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
  await datePopover.getByRole("button", { name: /^today$/i }).click();

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

  // The event form should treat deadlines as time-only items, expose colour
  // choices, and keep the themed location field from drawing the old pink ring.
  await page.getByRole("button", { name: /new item/i }).click();
  const eventDialog = page.locator(".coordinate-event-dialog").last();
  await expect(eventDialog).toBeVisible();
  await eventDialog.getByRole("button", { name: /^deadline$/i }).click();
  await expect(eventDialog.getByText(/^All Day$/)).toHaveCount(0);
  await expect(eventDialog.getByText(/^Ends$/)).toHaveCount(0);
  await expect(eventDialog.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
  await expect(eventDialog.locator(".coordinate-color-options")).toBeVisible();
  const locationShell = eventDialog.locator(".coordinate-location-input");
  await locationShell.locator("input").fill("Scara");
  await expect
    .poll(() => locationShell.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe("none");
  await eventDialog.getByRole("button", { name: /close calendar item/i }).click();

  await page.getByLabel(/Create Item At 4 Jul, 10 AM/i).click();
  const slotDialog = page.locator(".coordinate-event-dialog").last();
  await expect(slotDialog.locator("input[name='startsAt']")).toHaveValue("2026-07-04T10:00");
  await expect(slotDialog.locator("input[name='endsAt']")).toHaveValue("2026-07-04T10:30");
  await slotDialog.getByRole("button", { name: /close calendar item/i }).click();

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
  await expect(page.locator(".coordinate-event-block:has-text('Manual Button Item')")).toBeVisible();

  await page.getByRole("button", { name: /^availability$/i }).click();
  await expect(page.getByText("Project Meeting |")).toHaveCount(0);
  const availableBestSlot = page.locator(".coordinate-heat-slot").first();
  await expect(availableBestSlot).toBeVisible();
  const availableBestBorders = await availableBestSlot.evaluate((element) => {
    element.classList.add("own-available", "best");
    const borders = {
      own: getComputedStyle(element, "::before").borderColor,
      best: getComputedStyle(element, "::after").borderColor,
    };
    element.classList.remove("own-available", "best");
    return borders;
  });
  expect(availableBestBorders.best).toBe(availableBestBorders.own);
  await expect(page.getByText("29 Jun – 5 Jul")).toBeVisible();
  await expect(page.locator(".coordinate-availability-header").getByText("4 Jul – 12 Jul, 9 AM – 5 PM")).toBeVisible();

  // Editing availability is a draft action: Cancel must restore the original
  // response rather than leaving newly painted cells in the UI.
  const firstHeatSlot = page.locator(".coordinate-heat-slot[data-slot-start]").first();
  await firstHeatSlot.hover();
  const neutralHoverOutline = await firstHeatSlot.evaluate((element) => getComputedStyle(element).outlineColor);
  await page.getByRole("button", { name: /^edit availability$/i }).click();
  await page.getByRole("button", { name: /^if needed$/i }).click();
  await firstHeatSlot.hover();
  const ifNeededHoverOutline = await firstHeatSlot.evaluate((element) => getComputedStyle(element).outlineColor);
  expect(neutralHoverOutline).not.toBe(ifNeededHoverOutline);
  await page.getByRole("button", { name: /^available$/i }).click();
  await firstHeatSlot.click();
  await expect(firstHeatSlot).toHaveClass(/own-available/);
  await page.getByRole("button", { name: /^cancel$/i }).click();
  await expect(firstHeatSlot).not.toHaveClass(/own-available/);

  const selectAll = page.locator(".coordinate-select-all-toggle");
  await expect(selectAll).toContainText("Deselect All");
  await selectAll.click();
  await expect(selectAll).toContainText("Select All");
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
  await editWindowDialog.getByRole("button", { name: /^save window$/i }).click();
  const saveWindowBody = (await saveWindowRequest).postDataJSON();
  expect(saveWindowBody.selectedDates).toEqual([
    "2026-07-04",
    "2026-07-05",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
  ]);
  await expect(editWindowDialog).toBeHidden();

  await page.getByRole("button", { name: /new window/i }).click();
  const windowDialog = page.locator(".coordinate-window-dialog");
  await expect(windowDialog).toBeVisible();
  await expect(windowDialog.getByText(/^From$/)).toHaveCount(0);
  await expect(windowDialog.getByText(/^To$/)).toHaveCount(0);
  await expect(windowDialog.getByRole("button", { name: /^cancel$/i })).toHaveCount(0);
  await expect(windowDialog.getByRole("button", { name: /^create window$/i })).toBeVisible();
});
