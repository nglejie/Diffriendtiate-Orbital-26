export const themePresets = [
  {
    id: "bay",
    name: "Study Bay",
    colors: ["#0f4c5c", "#2a9d8f", "#f4a261"],
  },
  {
    id: "orchard",
    name: "Orchard",
    colors: ["#7f5539", "#b08968", "#ccd5ae"],
  },
  {
    id: "skyline",
    name: "Skyline",
    colors: ["#283618", "#606c38", "#dda15e"],
  },
  {
    id: "library",
    name: "Library",
    colors: ["#2b2d42", "#8d99ae", "#ef233c"],
  },
];

export const emptyRoomForm = {
  name: "",
  moduleCode: "",
  description: "",
  visibility: "public",
  tags: "",
  theme: "bay",
};

export function getTheme(themeId) {
  return themePresets.find((theme) => theme.id === themeId) || themePresets[0];
}
