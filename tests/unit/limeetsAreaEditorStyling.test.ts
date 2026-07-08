import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "apps/client/src/styles.css"), "utf8");
const virtualStudySpaceSource = readFileSync(
  resolve(process.cwd(), "apps/client/src/features/room/space/VirtualStudySpace.tsx"),
  "utf8",
);
const roomViewSource = readFileSync(resolve(process.cwd(), "apps/client/src/features/room/RoomView.tsx"), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  return match?.[1] || "";
}

function finalCssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "gm"))];
  return matches.at(-1)?.[1] || "";
}

describe("Limeets area editor styling", () => {
  it("keeps the select tool cursor as the default arrow", () => {
    const selectRule = cssRule(".limeets-gather-viewport.limeets-select-cursor");
    const activeSelectRule = cssRule(".limeets-gather-viewport.limeets-select-cursor:active");

    expect(selectRule).toContain("cursor: default");
    expect(activeSelectRule).toContain("cursor: default");
  });

  it("keeps Area Editor grouped with the primary map tools", () => {
    const toolbarStart = virtualStudySpaceSource.indexOf('className="limeets-gather-toolbar"');
    const toolbarEnd = virtualStudySpaceSource.indexOf('className="limeets-gather-controls"', toolbarStart);
    const toolbarSource = virtualStudySpaceSource.slice(toolbarStart, toolbarEnd);
    const toolGroups = [...toolbarSource.matchAll(/<div className="limeets-gather-tool-group">([\s\S]*?)<\/div>/g)]
      .map((match) => match[1]);
    const primaryToolGroup = toolGroups.find((group) => group.includes('label="Objects"')) || "";
    const setupToolGroup = toolGroups.find((group) => group.includes('label="Setup & Zones"')) || "";

    expect(primaryToolGroup).toContain('label="Select"');
    expect(primaryToolGroup).toContain('label="Eraser"');
    expect(primaryToolGroup).toContain('label="Area Editor"');
    expect(setupToolGroup).toContain('label="Setup & Zones"');
    expect(setupToolGroup).not.toContain('label="Area Editor"');
  });

  it("keeps selected-area property remove buttons as plain icon controls", () => {
    const rule = cssRule(".limeets-gather-area-property-remove");

    expect(rule).toContain("border: 0");
    expect(rule).toContain("background: transparent");
    expect(rule).toContain("color: var(--limeets-editor-muted)");
    expect(rule).not.toContain("#f6c177");
  });

  it("keeps destructive area deletion in the top action grid with danger styling", () => {
    const rule = cssRule(".limeets-gather-area-action-grid button.danger");

    expect(rule).toContain("var(--danger)");
    expect(rule).not.toContain("#f6c177");
  });

  it("keeps selected-area action buttons compact and square", () => {
    const rule = cssRule(".limeets-gather-area-action-grid button");

    expect(rule).toContain("width: 48px");
    expect(rule).toContain("height: 48px");
    expect(rule).toContain("border-radius: 12px");
  });

  it("keeps the Objects editor search bar at the taller fixed size", () => {
    const rule = cssRule(".limeets-gather-search");

    expect(rule).toContain("flex: 0 0 44px");
    expect(rule).toContain("height: 44px");
    expect(rule).toContain("min-height: 44px");
  });

  it("keeps the bottom-left user profile dock flush and visually distinct", () => {
    const dockRule = cssRule(".room-sidebar-dock");
    const voiceDockRule = cssRule(".room-voice-dock");
    const voiceConnectedRule = cssRule(".room-voice-connected");
    const controlsRule = finalCssRule(".room-user-controls");

    expect(dockRule).toContain("padding: 0");
    expect(voiceDockRule).toContain("gap: 0");
    expect(voiceConnectedRule).toContain("border-bottom: 0");
    expect(voiceConnectedRule).toContain("border-radius: 12px 12px 0 0");
    expect(controlsRule).toContain("background: color-mix(in srgb, var(--midnight-card-hover) 84%, var(--theme-base))");
    expect(controlsRule).toContain("border-left: 0");
    expect(controlsRule).toContain("border-right: 0");
    expect(controlsRule).toContain("border-bottom: 0");
    expect(controlsRule).toContain("border-radius: 0");
  });

  it("keeps the expanded room context panel left and right content padding balanced", () => {
    const panelRule = cssRule(".room-context-panel");
    const contentRule = cssRule(".room-context-content");

    expect(panelRule).toContain("padding: 20px 0 calc(var(--room-dock-reserve) + 24px) 18px");
    expect(contentRule).toContain("margin-right: 0");
    expect(contentRule).toContain("padding-right: 18px");
    expect(contentRule).toContain("scrollbar-gutter: auto");
  });

  it("keeps Limeets meeting-room overlays available without blocking map input", () => {
    const sharedOverlayRule = styles.slice(
      styles.indexOf(".limeets-gather-meeting-spotlight,"),
      styles.indexOf(".limeets-gather-meeting-spotlight {"),
    );
    const avatarRule = cssRule(".limeets-gather-avatar");
    const spotlightRule = cssRule(".limeets-gather-meeting-spotlight");
    const meetingLayerRule = finalCssRule(".limeets-gather-meeting-areas-layer");
    const spotlightSegmentRule = cssRule(".limeets-gather-meeting-spotlight span");
    const highlightRule = cssRule(".limeets-gather-meeting-area-highlight");
    const sourceHasToggle = virtualStudySpaceSource.includes("Show Meeting Areas");

    expect(sharedOverlayRule).toContain("pointer-events: none");
    expect(avatarRule).toContain("z-index: 3900");
    expect(spotlightRule).toContain("z-index: 2300");
    expect(meetingLayerRule).toContain("z-index: 2400");
    expect(spotlightSegmentRule).toContain("rgba(4, 6, 13, 0.52)");
    expect(highlightRule).toContain("border: 2px solid");
    expect(sourceHasToggle).toBe(true);
  });

  it("keeps Limeets map controls icon choices and tooltips consistent", () => {
    const controlsRule = cssRule(".limeets-gather-controls");
    const hudRule = cssRule(".limeets-gather-hud");
    const ariaDisabledRule = cssRule('.limeets-gather-controls button[aria-disabled="true"]');
    const vectorRule = cssRule(".limeets-gather-vector-icon");
    const vectorOffRule = cssRule(".limeets-gather-vector-icon.off::after");

    expect(controlsRule).toContain("background: var(--app-toolbar-surface)");
    expect(controlsRule).toContain("border: 1px solid var(--app-toolbar-border)");
    expect(controlsRule).toContain("border-radius: var(--app-toolbar-radius)");
    expect(controlsRule).toContain("box-shadow: var(--app-toolbar-shadow)");
    expect(controlsRule).toContain("backdrop-filter: var(--app-toolbar-backdrop)");
    expect(controlsRule).toContain("overflow: visible");
    expect(hudRule).toContain("background: var(--app-toolbar-surface)");
    expect(hudRule).toContain("border: 1px solid var(--app-toolbar-border)");
    expect(hudRule).toContain("border-radius: var(--app-toolbar-radius)");
    expect(hudRule).toContain("box-shadow: var(--app-toolbar-shadow)");
    expect(hudRule).toContain("backdrop-filter: var(--app-toolbar-backdrop)");
    expect(virtualStudySpaceSource).toContain('worldRoom.name === "World" ? "Domain" : worldRoom.name');
    expect(virtualStudySpaceSource).toContain("<MapPinned");
    expect(virtualStudySpaceSource).toContain("<VectorSquare");
    expect(virtualStudySpaceSource).toContain('data-tooltip="Go To My Location"');
    expect(virtualStudySpaceSource).toContain('data-tooltip="Zoom In"');
    expect(virtualStudySpaceSource).toContain('data-tooltip="Zoom Out"');
    expect(virtualStudySpaceSource).toContain('data-tooltip="Fit Zone"');
    expect(virtualStudySpaceSource).toContain('data-tooltip="More Options"');
    expect(ariaDisabledRule).toContain("cursor: default");
    expect(vectorRule).toContain("place-items: center");
    expect(vectorOffRule).toContain("rotate(-38deg)");
  });

  it("keeps the Open Link action prompt aligned with shared toolbar surfaces", () => {
    const promptRule = cssRule(".limeets-gather-link-action");
    const promptStripeRule = cssRule(".limeets-gather-link-action::before");
    const promptIconRule = cssRule(".limeets-gather-link-action .limeets-gather-current-icon");
    const promptButtonRule = cssRule(".limeets-gather-link-open");

    expect(promptRule).toContain("width: min(560px, calc(100% - 40px))");
    expect(promptRule).toContain("min-height: 74px");
    expect(promptRule).toContain("border-color: var(--app-toolbar-border)");
    expect(promptRule).toContain("border-radius: var(--app-toolbar-radius)");
    expect(promptRule).toContain("background: var(--app-toolbar-surface)");
    expect(promptRule).toContain("box-shadow: var(--app-toolbar-shadow)");
    expect(promptRule).toContain("backdrop-filter: var(--app-toolbar-backdrop)");
    expect(promptRule).not.toContain("radial-gradient");
    expect(promptStripeRule).toContain("display: none");
    expect(promptIconRule).toContain("border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent)");
    expect(promptIconRule).toContain("color: color-mix(in srgb, var(--text-primary) 74%, transparent)");
    expect(promptIconRule).toContain("background: color-mix(in srgb, var(--text-primary) 6%, transparent)");
    expect(promptIconRule).toContain("box-shadow: none");
    expect(promptButtonRule).toContain("min-height: 38px");
    expect(promptButtonRule).toContain("border-radius: 8px");
    expect(promptButtonRule).toContain("background: var(--accent-primary)");
    expect(promptButtonRule).not.toContain("linear-gradient");
  });

  it("keeps Limeets editor notices top-centered and out of the editor panel", () => {
    const toastRule = finalCssRule(".limeets-gather-toast");

    expect(virtualStudySpaceSource).toContain('className="limeets-gather-toast"');
    expect(virtualStudySpaceSource).toContain('role="status"');
    expect(toastRule).toContain("position: fixed");
    expect(toastRule).toContain("top: 18px");
    expect(toastRule).toContain("left: 50%");
    expect(toastRule).toContain("right: auto");
    expect(toastRule).toContain("bottom: auto");
    expect(toastRule).toContain("transform: translateX(-50%)");
    expect(toastRule).toContain("width: min(420px, calc(100vw - 40px))");
    expect(toastRule).toContain("min-height: 62px");
    expect(toastRule).toContain(
      "background: color-mix(in srgb, var(--rose-pine-pine) 18%, var(--midnight-card-strong) 82%)",
    );
    expect(toastRule).toContain("border: 1px solid var(--midnight-border)");
    expect(toastRule).toContain("backdrop-filter: blur(18px) saturate(1.08)");
    expect(toastRule).not.toContain("border-radius: 999px");
    expect(toastRule).not.toContain("bottom: 24px");
  });

  it("rehydrates Limeets meeting-area state after returning from the meeting tab", () => {
    const hiddenPanelRule = cssRule(".room-content-panel.is-hidden");

    expect(hiddenPanelRule).toContain("display: none");
    expect(roomViewSource).toContain("currentMeetingArea={activeMeetingArea}");
    expect(roomViewSource).toContain('isActive={activeTab === "space"}');
    expect(roomViewSource).toContain('activeTab === "space" ? "" : "is-hidden"');
    expect(roomViewSource).toContain('const LIMEETS_MEETING_AREA_STORAGE_KEY = "limeetsMeetingArea"');
    expect(roomViewSource).toContain('const ROOM_ACTIVE_TAB_STORAGE_KEY = "activeTab"');
    expect(roomViewSource).toContain("readStoredRoomActiveTab(room?.id)");
    expect(roomViewSource).toContain("writeStoredRoomActiveTab(room?.id, nextTabId)");
    expect(roomViewSource).toContain('setActiveTab(storedActiveTab === "meetings" && !storedMeetingArea ? "space" : storedActiveTab)');
    expect(roomViewSource).toContain("readStoredLimeetsMeetingArea(room?.id)");
    expect(roomViewSource).toContain("writeStoredLimeetsMeetingArea(room?.id, nextMeetingArea)");
    expect(roomViewSource).toContain("clearStoredLimeetsMeetingArea(room?.id)");
    expect(roomViewSource).toContain("roomSocketConnected");
    expect(roomViewSource).toContain("void limeetsMeeting.joinMeeting(areaId)");
    expect(virtualStudySpaceSource).toContain("isActive = true");
    expect(virtualStudySpaceSource).toContain("playerInitKeyRef");
    expect(virtualStudySpaceSource).toContain("initialCameraKeyRef");
    expect(virtualStudySpaceSource).toContain("if (!isActive) {");
    expect(virtualStudySpaceSource).toContain("currentMeetingArea = null");
    expect(virtualStudySpaceSource).toContain(
      'const currentMeetingAreaId = String(currentMeetingArea?.id || currentMeetingArea?.areaId || "")',
    );
    expect(virtualStudySpaceSource).toContain("meetingAreaRef.current = currentMeetingAreaId");
    expect(virtualStudySpaceSource).toContain("setActiveMeetingAreaId(currentMeetingAreaId)");
    expect(virtualStudySpaceSource).toContain("readMeetingAreaVisibilityStorage(room?.id)");
    expect(virtualStudySpaceSource).toContain("writeMeetingAreaVisibilityStorage(roomIdRef.current || room?.id, next)");
  });

  it("restores the collapsed room profile dock to a compact avatar-only target", () => {
    const collapsedDockRule = cssRule(".room-workspace.context-collapsed .room-sidebar-dock");
    const collapsedControlsRule = cssRule(".room-workspace.context-collapsed .room-user-controls");
    const collapsedButtonRule = cssRule(".room-workspace.context-collapsed .room-call-user-button");

    expect(collapsedDockRule).toContain("justify-items: center");
    expect(collapsedDockRule).toContain("padding: 0 8px 12px");
    expect(collapsedControlsRule).toContain("width: auto");
    expect(collapsedControlsRule).toContain("background: transparent");
    expect(collapsedControlsRule).toContain("border: 0");
    expect(collapsedControlsRule).toContain("box-shadow: none");
    expect(collapsedButtonRule).toContain("width: auto");
    expect(collapsedButtonRule).toContain("border-radius: var(--default-avatar-radius)");
  });
});
