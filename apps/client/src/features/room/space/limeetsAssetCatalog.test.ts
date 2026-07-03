import { describe, expect, it } from "vitest";
import {
  LIMEETS_OBJECT_ASSETS,
  canAssetUseLayer,
  getAssetColorOptions,
  getAssetDirectionOptions,
  getLimeetsAsset,
  getLimeetsAssetsForLayer,
  getSmartLayerForAsset,
} from "./limeetsAssetCatalog.ts";

describe("limeetsAssetCatalog", () => {
  it("builds a sizeable Gather-backed catalog without broken hex-label assets", () => {
    // The Gather source repo packs many sprites into sheets. This verifies the
    // manifest slicing pipeline exposes individual assets instead of raw sheets.
    expect(LIMEETS_OBJECT_ASSETS.length).toBeGreaterThan(500);
    expect(LIMEETS_OBJECT_ASSETS.some((asset) => asset.label === "#BEA69F")).toBe(false);
    expect(LIMEETS_OBJECT_ASSETS.every((asset) => asset.src.startsWith("/assets/limeets/"))).toBe(true);
  });

  it("keeps tilesheets and object sprites in their safe layer buckets", () => {
    const floorAsset = LIMEETS_OBJECT_ASSETS.find((asset) => asset.bucket === "tile" && asset.defaultLayer === "floor");
    const objectAsset = LIMEETS_OBJECT_ASSETS.find((asset) => asset.bucket === "object");

    expect(floorAsset).toBeTruthy();
    expect(objectAsset).toBeTruthy();
    expect(floorAsset?.allowedLayers).toEqual(["floor", "above_floor"]);
    expect(objectAsset?.allowedLayers).toEqual(["object"]);
    expect(canAssetUseLayer(floorAsset, "object")).toBe(false);
    expect(canAssetUseLayer(objectAsset, "above_floor")).toBe(false);
    expect(getSmartLayerForAsset(floorAsset!)).toBe("floor");
    expect(getSmartLayerForAsset(objectAsset!)).toBe("object");
  });

  it("returns layer-filtered assets without mixing incompatible buckets", () => {
    expect(getLimeetsAssetsForLayer("floor").every((asset) => asset.allowedLayers.includes("floor"))).toBe(true);
    expect(getLimeetsAssetsForLayer("above_floor").every((asset) => asset.allowedLayers.includes("above_floor"))).toBe(true);
    expect(getLimeetsAssetsForLayer("object").every((asset) => asset.allowedLayers.includes("object"))).toBe(true);
  });

  it("finds colour and direction variants for a Gather object family", () => {
    const variantFamily = LIMEETS_OBJECT_ASSETS.find((asset) => asset.variantKey && asset.direction);
    expect(variantFamily).toBeTruthy();

    const colourOptions = getAssetColorOptions(variantFamily);
    const directionOptions = getAssetDirectionOptions(variantFamily);

    expect(getLimeetsAsset(variantFamily!.id)).toEqual(variantFamily);
    expect(colourOptions.length).toBeGreaterThanOrEqual(1);
    expect(new Set(colourOptions.map((asset) => asset.variantKey || asset.id)).size)
      .toBe(colourOptions.length);
    expect(directionOptions.length).toBeGreaterThanOrEqual(1);
    expect(new Set(directionOptions.map((asset) => asset.direction || "default")).size)
      .toBe(directionOptions.length);
  });
});
