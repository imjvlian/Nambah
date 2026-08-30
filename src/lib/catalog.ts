export type GamePackage = {
  id: string;
  label: string;
  note?: string;
};

export type Game = {
  id: string;
  name: string;
  shortName: string;
  category: "game" | "voucher";
  accent: string;
  initials: string;
  requiresServer?: boolean;
  packages: GamePackage[];
};

export const games: Game[] = [
  {
    id: "mobile-legends",
    name: "Mobile Legends",
    shortName: "MLBB",
    category: "game",
    accent: "#78a7ff",
    initials: "ML",
    requiresServer: true,
    packages: [
      { id: "ml-5", label: "5 Diamonds" },
      { id: "ml-12", label: "12 Diamonds" },
      { id: "ml-28", label: "28 Diamonds" },
      { id: "ml-86", label: "86 Diamonds", note: "Populer" },
      { id: "ml-172", label: "172 Diamonds" },
      { id: "ml-wdp", label: "Weekly Diamond Pass", note: "Hemat" },
    ],
  },
  {
    id: "free-fire",
    name: "Free Fire",
    shortName: "Free Fire",
    category: "game",
    accent: "#ff9f42",
    initials: "FF",
    packages: [
      { id: "ff-5", label: "5 Diamonds" },
      { id: "ff-20", label: "20 Diamonds" },
      { id: "ff-50", label: "50 Diamonds" },
      { id: "ff-100", label: "100 Diamonds", note: "Populer" },
      { id: "ff-210", label: "210 Diamonds" },
      { id: "ff-membership", label: "Weekly Membership" },
    ],
  },
  {
    id: "pubg-mobile",
    name: "PUBG Mobile",
    shortName: "PUBG",
    category: "game",
    accent: "#f4c44e",
    initials: "PB",
    packages: [
      { id: "pubg-60", label: "60 UC" },
      { id: "pubg-325", label: "325 UC", note: "Populer" },
      { id: "pubg-660", label: "660 UC" },
      { id: "pubg-1800", label: "1800 UC" },
    ],
  },
  {
    id: "valorant",
    name: "Valorant",
    shortName: "Valorant",
    category: "voucher",
    accent: "#ff6675",
    initials: "VL",
    packages: [
      { id: "valo-125", label: "125 Points" },
      { id: "valo-420", label: "420 Points", note: "Populer" },
      { id: "valo-700", label: "700 Points" },
      { id: "valo-1375", label: "1375 Points" },
    ],
  },
  {
    id: "honor-of-kings",
    name: "Honor of Kings",
    shortName: "HOK",
    category: "game",
    accent: "#e5b866",
    initials: "HK",
    packages: [
      { id: "hok-16", label: "16 Tokens" },
      { id: "hok-80", label: "80 Tokens" },
      { id: "hok-240", label: "240 Tokens", note: "Populer" },
      { id: "hok-weekly", label: "Weekly Card" },
    ],
  },
  {
    id: "genshin-impact",
    name: "Genshin Impact",
    shortName: "Genshin",
    category: "game",
    accent: "#89d4e3",
    initials: "GI",
    requiresServer: true,
    packages: [
      { id: "gi-60", label: "60 Genesis Crystals" },
      { id: "gi-300", label: "300 + 30 Crystals" },
      { id: "gi-welkin", label: "Blessing of the Welkin Moon", note: "Populer" },
    ],
  },
  {
    id: "roblox",
    name: "Roblox",
    shortName: "Roblox",
    category: "voucher",
    accent: "#b9bec8",
    initials: "RB",
    packages: [
      { id: "rb-50", label: "50 Robux" },
      { id: "rb-100", label: "100 Robux" },
      { id: "rb-400", label: "400 Robux", note: "Populer" },
    ],
  },
  {
    id: "steam-wallet",
    name: "Steam Wallet",
    shortName: "Steam",
    category: "voucher",
    accent: "#7fc2ff",
    initials: "ST",
    packages: [
      { id: "steam-12", label: "Steam Wallet IDR 12.000" },
      { id: "steam-45", label: "Steam Wallet IDR 45.000" },
      { id: "steam-90", label: "Steam Wallet IDR 90.000", note: "Populer" },
    ],
  },
];

export const paymentMethods = [
  { id: "qris", name: "QRIS", detail: "Semua aplikasi pembayaran" },
  { id: "ewallet", name: "E-Wallet", detail: "GoPay, DANA, ShopeePay dan lainnya" },
  { id: "va", name: "Virtual Account", detail: "Transfer bank otomatis" },
] as const;
