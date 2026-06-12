export const themePresets = [
  {
    id: "twilight",
    name: "Twilight Room",
    colors: ["#1a0628", "#7b3bb2", "#ff78a6"],
  },
  {
    id: "rose",
    name: "Rose Archive",
    colors: ["#351244", "#c04d91", "#ffd3bd"],
  },
  {
    id: "sunset",
    name: "Sunset Quest",
    colors: ["#3a1751", "#f06f8f", "#ffb86b"],
  },
  {
    id: "starlight",
    name: "Starlight Notes",
    colors: ["#22103c", "#9d7bff", "#ffe88a"],
  },
];

export const emptyRoomForm = {
  name: "",
  moduleCode: "",
  description: "",
  visibility: "public",
  tags: "",
  theme: "twilight",
};

export function getTheme(themeId) {
  return themePresets.find((theme) => theme.id === themeId) || themePresets[0];
}
