import { describe, expect, it } from "vitest";
import {
  buildAreaProperties,
  getAreaCursorClass,
  getAreaEditModeAtPoint,
  getAreaRectFromEditDrag,
  getEnabledAreaPropertyIds,
  getAreaOpenLinkOptions,
  getFirstEnabledAreaPropertyId,
  normalizeExternalAreaUrl,
  shouldRunLandingEffect,
  usesRectangleTileAction,
} from "../../apps/client/src/features/room/space/VirtualStudySpace.tsx";
import { normalizeWorldConfig } from "../../apps/client/src/features/room/space/worldConfig.ts";

const world = {
  columns: 10,
  rows: 8,
  tileSize: 32,
  width: 320,
  height: 256,
};

describe("Limeets area editor helpers", () => {
  it("normalizes safe area links and blocks unsupported URL schemes", () => {
    expect(normalizeExternalAreaUrl("https://example.edu/module")).toBe("https://example.edu/module");
    expect(normalizeExternalAreaUrl("nus.edu.sg/canvas")).toBe("https://nus.edu.sg/canvas");
    expect(normalizeExternalAreaUrl("javascript:alert(1)")).toBe("");
    expect(normalizeExternalAreaUrl("not a url")).toBe("");
  });

  it("detects move, edge resize, corner resize, and outside hits", () => {
    const area = { bounds: { col: 2, row: 2, width: 3, height: 2 } };

    expect(getAreaEditModeAtPoint({ x: 96, y: 80 }, area, world)).toBe("move");
    expect(getAreaEditModeAtPoint({ x: 64, y: 64 }, area, world)).toBe("nw");
    expect(getAreaEditModeAtPoint({ x: 160, y: 96 }, area, world)).toBe("e");
    expect(getAreaEditModeAtPoint({ x: 220, y: 160 }, area, world)).toBe("");
  });

  it("maps area edit modes to explicit viewport cursor classes", () => {
    expect(getAreaCursorClass("draw")).toBe("limeets-area-cursor-draw");
    expect(getAreaCursorClass("move")).toBe("limeets-area-cursor-move");
    expect(getAreaCursorClass("e")).toBe("limeets-area-cursor-e");
    expect(getAreaCursorClass("nw")).toBe("limeets-area-cursor-nw");
    expect(getAreaCursorClass("unknown")).toBe("");
    expect(getAreaCursorClass("")).toBe("");
  });

  it("keeps select and eraser rectangle-based even when placement mode is single", () => {
    expect(usesRectangleTileAction("select", "single")).toBe(true);
    expect(usesRectangleTileAction("erase", "single")).toBe(true);
    expect(usesRectangleTileAction("paint", "single")).toBe(false);
    expect(usesRectangleTileAction("paint", "rectangle")).toBe(true);
  });

  it("keeps the selected area property panel stable when an enabled property is preferred", () => {
    const effects = { entryExit: true, meeting: true, openLink: false };

    expect(getFirstEnabledAreaPropertyId(effects, "meeting")).toBe("meeting");
    expect(getFirstEnabledAreaPropertyId(effects, "openLink")).toBe("meeting");
    expect(getFirstEnabledAreaPropertyId({}, "meeting")).toBe("");
  });

  it("returns enabled area properties in the same visual order as the editor action grid", () => {
    const effects = {
      entryExit: true,
      impassable: true,
      meeting: true,
      openLink: true,
      teleport: false,
    };

    expect(getEnabledAreaPropertyIds(effects)).toEqual(["meeting", "entryExit", "openLink", "impassable"]);
  });

  it("keeps Open Link configuration limited to implemented controls", () => {
    const area = {
      effects: { openLink: true },
      linkUrl: "www.google.com",
      openLinkAllowApi: true,
      openLinkClosable: false,
      openLinkHideUrl: true,
      openLinkInteraction: "enter",
      openLinkNewTab: true,
      openLinkWidth: 75,
    };

    expect(getAreaOpenLinkOptions(area)).toEqual({ interaction: "enter", newTab: true });
    const openWebsite = buildAreaProperties(area).find((property) => property.type === "openWebsite");
    expect(openWebsite).toEqual({
      newTab: true,
      trigger: "enter",
      type: "openWebsite",
      url: "https://www.google.com",
    });
    expect(openWebsite).not.toHaveProperty("allowApi");
    expect(openWebsite).not.toHaveProperty("closable");
    expect(openWebsite).not.toHaveProperty("hideUrl");
    expect(openWebsite).not.toHaveProperty("width");
  });

  it("preserves Open Link interaction fields while normalizing world config", () => {
    const normalized = normalizeWorldConfig({
      privateAreas: [
        {
          id: "area-link",
          bounds: { col: 1, row: 2, width: 3, height: 4 },
          effects: { openLink: true },
          linkUrl: "https://example.edu",
          openLinkInteraction: "enter",
          openLinkNewTab: true,
        },
      ],
    });

    expect(normalized.privateAreas[0]).toMatchObject({
      linkUrl: "https://example.edu",
      openLinkInteraction: "enter",
      openLinkNewTab: true,
    });
  });

  it("runs area effects only after landing and only once until re-entry", () => {
    const idleActionKey = "custom-world:4,5:area-1:::https://example.edu";

    expect(
      shouldRunLandingEffect({
        idleActionKey,
        lastIdleActionKey: "",
        moving: true,
        triggeredAreaId: "",
        triggerAreaId: "area-1",
      }),
    ).toBe(false);

    expect(
      shouldRunLandingEffect({
        idleActionKey,
        lastIdleActionKey: "",
        moving: false,
        triggeredAreaId: "",
        triggerAreaId: "area-1",
      }),
    ).toBe(true);

    expect(
      shouldRunLandingEffect({
        idleActionKey: "custom-world:4,6:area-1:::https://example.edu",
        lastIdleActionKey: "",
        moving: false,
        triggeredAreaId: "area-1",
        triggerAreaId: "area-1",
      }),
    ).toBe(false);

    expect(
      shouldRunLandingEffect({
        idleActionKey,
        lastIdleActionKey: "",
        moving: false,
        triggeredAreaId: "",
        triggerAreaId: "area-1",
      }),
    ).toBe(true);
  });

  it("moves areas by whole tiles and clamps them inside the zone", () => {
    const drag = {
      mode: "move",
      startBounds: { col: 2, row: 2, width: 3, height: 2 },
      startPoint: { x: 80, y: 80 },
    };

    expect(getAreaRectFromEditDrag(drag, { x: 144, y: 48 }, world)?.bounds).toEqual({
      col: 4,
      row: 1,
      width: 3,
      height: 2,
    });
    expect(getAreaRectFromEditDrag(drag, { x: 999, y: 999 }, world)?.bounds).toEqual({
      col: 7,
      row: 6,
      width: 3,
      height: 2,
    });
  });

  it("resizes from edges and preserves a minimum one-tile area", () => {
    const eastDrag = {
      mode: "e",
      startBounds: { col: 2, row: 2, width: 3, height: 2 },
      startPoint: { x: 160, y: 80 },
    };
    const westDrag = {
      mode: "w",
      startBounds: { col: 2, row: 2, width: 3, height: 2 },
      startPoint: { x: 64, y: 80 },
    };

    expect(getAreaRectFromEditDrag(eastDrag, { x: 224, y: 80 }, world)?.bounds).toEqual({
      col: 2,
      row: 2,
      width: 5,
      height: 2,
    });
    expect(getAreaRectFromEditDrag(westDrag, { x: 224, y: 80 }, world)?.bounds).toEqual({
      col: 4,
      row: 2,
      width: 1,
      height: 2,
    });
  });
});
