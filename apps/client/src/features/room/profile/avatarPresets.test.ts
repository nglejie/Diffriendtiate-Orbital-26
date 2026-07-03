import { describe, expect, it } from "vitest";
import {
  AVATAR_SLOT_GROUPS,
  getAvatarSlotChoices,
  getAvatarSlotItems,
  getDefaultAvatarVariantId,
  getGatherAvatarFrameIndex,
  normalizeLimeetsAvatarPreset,
  withAvatarSelection,
} from "./avatarPresets.ts";

describe("avatarPresets", () => {
  it("exposes the expected Gather-style avatar customization groups", () => {
    // Keeps the picker aligned with the product grouping used in Gather:
    // Base, Clothing, Accessories, and Special.
    expect(AVATAR_SLOT_GROUPS).toEqual([
      { id: "base", label: "Base", slots: ["skin", "hair", "facial_hair"] },
      { id: "clothing", label: "Clothing", slots: ["top", "jacket", "bottom", "shoes"] },
      { id: "accessories", label: "Accessories", slots: ["hat", "glasses", "mobility", "others"] },
      { id: "special", label: "Special", slots: ["special_preset"] },
    ]);
  });

  it("normalizes invalid avatar selections into a renderable layered avatar", () => {
    const avatar = normalizeLimeetsAvatarPreset({
      selections: {
        skin: { itemId: "missing", variantId: "missing" },
        hair: null,
        top: { itemId: "t shirt", variantId: "blue" },
      },
    });

    expect(avatar.version).toBe(1);
    expect(avatar.layers.length).toBeGreaterThan(0);
    expect(avatar.layers.every((layer) => layer.src.startsWith("/assets/limeets/avatars/gather/"))).toBe(true);
    expect(avatar.selections.skin).toBeTruthy();
    expect(avatar.selections.hair).toBeTruthy();
  });

  it("updates one avatar slot without losing the rest of the preset", () => {
    const avatar = normalizeLimeetsAvatarPreset(null);
    const variantId = getDefaultAvatarVariantId("top", "t shirt");
    const updated = withAvatarSelection(avatar, "top", { itemId: "t shirt", variantId });

    expect(updated.selections.top).toEqual({ itemId: "t shirt", variantId });
    expect(updated.selections.skin).toEqual(avatar.selections.skin);
    expect(updated.id).toContain("top:t shirt");
  });

  it("cycles Gather walking frames through standing, step A, standing, step B", () => {
    // This directly guards the jerky/wrong walking regression: idle stays on the
    // standing frame, while movement alternates both leg frames.
    expect(getGatherAvatarFrameIndex("down", false, 99)).toBe(0);
    expect([
      getGatherAvatarFrameIndex("down", true, 0),
      getGatherAvatarFrameIndex("down", true, 1),
      getGatherAvatarFrameIndex("down", true, 2),
      getGatherAvatarFrameIndex("down", true, 3),
    ]).toEqual([0, 1, 0, 2]);
    expect([
      getGatherAvatarFrameIndex("left", true, 0),
      getGatherAvatarFrameIndex("up", true, 0),
      getGatherAvatarFrameIndex("right", true, 0),
    ]).toEqual([3, 6, 9]);
  });

  it("provides item previews and multi-choice colour swatches for picker slots", () => {
    const tops = getAvatarSlotItems("top");
    expect(tops.length).toBeGreaterThan(0);
    expect(tops[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
    });

    const choices = getAvatarSlotChoices("top", tops[0].id);
    expect(choices.length).toBeGreaterThan(0);
    expect(choices[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      swatch: expect.stringMatching(/^#/),
    });
  });
});
