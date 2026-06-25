export const THEME_STORAGE_KEY = "diffriendtiate:theme-mode";

export const THEME_MODES = {
  dark: "dark",
  light: "light",
};

export const ROSELY_PALETTE = {
  blackBeauty: "#27272a",
  graniteGray: "#615f5f",
  opalGray: "#a49e9e",
  sugarSwizzle: "#f4eee8",
  morningGlory: "#ec809e",
  roseQuartz: "#f7caca",
  barelyPink: "#f8d7dd",
  heavenlyPink: "#f4dede",
  grapeade: "#85677b",
  radiantOrchid: "#b565a7",
  lupine: "#be9cc1",
  lavenderFog: "#d2c4d6",
  raspberrySorbet: "#d2386c",
  spearmint: "#64bfa4",
  aquarius: "#3cadd4",
  meadowlark: "#eada4f",
  mauve: "#ac537e",
  warmGold: "#f4cf70",
};

export const ROSE_PINE_PALETTE = {
  base: "#191724",
  surface: "#1f1d2e",
  overlay: "#26233a",
  muted: "#6e6a86",
  subtle: "#908caa",
  text: "#e0def4",
  love: "#eb6f92",
  gold: "#f6c177",
  rose: "#ebbcba",
  pine: "#31748f",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
};

export function normaliseThemeMode(value) {
  return value === THEME_MODES.light ? THEME_MODES.light : THEME_MODES.dark;
}

export function readStoredThemeMode() {
  if (typeof window === "undefined") return THEME_MODES.dark;
  return normaliseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function applyThemeMode(value) {
  if (typeof document === "undefined") return;

  const themeMode = normaliseThemeMode(value);
  document.documentElement.dataset.theme = themeMode;
  document.documentElement.style.colorScheme = themeMode;
}

export function storeThemeMode(value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, normaliseThemeMode(value));
}
