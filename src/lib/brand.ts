export const BRAND = {
  name: "Nambah",
  shortName: "Nambah",
  tagline: "Top up? Nambah aja.",
  domain: "nambah.id",
  url: "https://nambah.id",
  description: "Top up game cepat, aman, dan harga terjangkau. Top up? Nambah aja.",
  themeColor: "#0a0b0a",
  backgroundColor: "#0a0b0a",
  brandColor: "#c9ff3f",
  brandInk: "#11130f",
  colors: {
    lime: { 50: "#f6ffe5", 100: "#eeffcc", 200: "#ddff99", 300: "#cbff66", 400: "#baff33", 500: "#c9ff3f", 600: "#b6e636", 700: "#9dcc22", 800: "#7fa31b", 900: "#5f7f16" },
  },
} as const;
export type Brand = typeof BRAND;