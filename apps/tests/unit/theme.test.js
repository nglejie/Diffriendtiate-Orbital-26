import { afterEach, describe, expect, it } from "vitest";
import {
  THEME_MODES,
  THEME_STORAGE_KEY,
  applyThemeMode,
  normaliseThemeMode,
  readStoredThemeMode,
  storeThemeMode,
} from "../../client/src/theme.js";

describe("theme mode utilities", () => {
  afterEach(() => {
    // Theme helpers write to browser globals, so each test resets jsdom to avoid
    // a previous theme selection leaking into the next case.
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  // Verifies defensive theme normalization. Any unsupported, corrupted, or
  // missing value should safely fall back to dark mode so the app never enters
  // an undefined visual state.
  it("defaults unknown values to dark mode", () => {
    expect(normaliseThemeMode("light")).toBe(THEME_MODES.light);
    expect(normaliseThemeMode("dark")).toBe(THEME_MODES.dark);
    expect(normaliseThemeMode("sepia")).toBe(THEME_MODES.dark);
    expect(normaliseThemeMode(undefined)).toBe(THEME_MODES.dark);
  });

  // Confirms applying a theme updates both the data attribute used by CSS and
  // the browser color-scheme hint used for native controls and scrollbars.
  it("applies the data-theme and color-scheme consistently", () => {
    applyThemeMode("light");
    expect(document.documentElement.dataset.theme).toBe(THEME_MODES.light);
    expect(document.documentElement.style.colorScheme).toBe(THEME_MODES.light);
  });

  // Checks persistence through localStorage. Unsupported values are normalized
  // before storage, then a valid light-mode selection can be read back exactly.
  it("persists only supported theme modes", () => {
    storeThemeMode("unknown");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEME_MODES.dark);
    expect(readStoredThemeMode()).toBe(THEME_MODES.dark);

    storeThemeMode("light");
    expect(readStoredThemeMode()).toBe(THEME_MODES.light);
  });
});
