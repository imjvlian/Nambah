export type GamePackage = {
  id: string;
  label: string;
  note?: string;
  sellingPrice: number;
  referencePrice: number;
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

export type PaymentMethod = {
  id: string;
  name: string;
  detail: string;
  customerFeeFlat: number;
  customerFeePercent: number;
  merchantFeeFlat: number;
  merchantFeePercent: number;
};

// Public-safe catalog for the MVP only. Supplier costs intentionally live in a
// server-side module and must never be sent to the customer bundle.
// referencePrice must represent a defensible normal/reference price before going live.
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
      { id: "ml-5", label: "5 Diamonds", sellingPrice: 2000, referencePrice: 2500 },
      { id: "ml-12", label: "12 Diamonds", sellingPrice: 4500, referencePrice: 5000 },
      { id: "ml-28", label: "28 Diamonds", sellingPrice: 8500, referencePrice: 10000 },
      { id: "ml-86", label: "86 Diamonds", note: "Populer", sellingPrice: 21500, referencePrice: 24000 },
      { id: "ml-172", label: "172 Diamonds", sellingPrice: 42000, referencePrice: 47000 },
      { id: "ml-wdp", label: "Weekly Diamond Pass", note: "Hemat", sellingPrice: 27000, referencePrice: 31000 },
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
      { id: "ff-5", label: "5 Diamonds", sellingPrice: 1500, referencePrice: 2000 },
      { id: "ff-20", label: "20 Diamonds", sellingPrice: 4000, referencePrice: 5000 },
      { id: "ff-50", label: "50 Diamonds", sellingPrice: 8000, referencePrice: 9000 },
      { id: "ff-100", label: "100 Diamonds", note: "Populer", sellingPrice: 12000, referencePrice: 14000 },
      { id: "ff-210", label: "210 Diamonds", sellingPrice: 23000, referencePrice: 26000 },
      { id: "ff-membership", label: "Weekly Membership", sellingPrice: 29000, referencePrice: 33000 },
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
      { id: "pubg-60", label: "60 UC", sellingPrice: 16000, referencePrice: 18000 },
      { id: "pubg-325", label: "325 UC", note: "Populer", sellingPrice: 76000, referencePrice: 85000 },
      { id: "pubg-660", label: "660 UC", sellingPrice: 147000, referencePrice: 160000 },
      { id: "pubg-1800", label: "1800 UC", sellingPrice: 365000, referencePrice: 395000 },
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
      { id: "valo-125", label: "125 Points", sellingPrice: 16000, referencePrice: 18000 },
      { id: "valo-420", label: "420 Points", note: "Populer", sellingPrice: 47000, referencePrice: 52000 },
      { id: "valo-700", label: "700 Points", sellingPrice: 74000, referencePrice: 81000 },
      { id: "valo-1375", label: "1375 Points", sellingPrice: 144000, referencePrice: 158000 },
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
      { id: "hok-16", label: "16 Tokens", sellingPrice: 4000, referencePrice: 5000 },
      { id: "hok-80", label: "80 Tokens", sellingPrice: 16000, referencePrice: 18000 },
      { id: "hok-240", label: "240 Tokens", note: "Populer", sellingPrice: 45000, referencePrice: 50000 },
      { id: "hok-weekly", label: "Weekly Card", sellingPrice: 22000, referencePrice: 25000 },
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
      { id: "gi-60", label: "60 Genesis Crystals", sellingPrice: 15000, referencePrice: 17000 },
      { id: "gi-300", label: "300 + 30 Crystals", sellingPrice: 70000, referencePrice: 77000 },
      { id: "gi-welkin", label: "Blessing of the Welkin Moon", note: "Populer", sellingPrice: 64000, referencePrice: 70000 },
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
      { id: "rb-50", label: "50 Robux", sellingPrice: 10000, referencePrice: 12000 },
      { id: "rb-100", label: "100 Robux", sellingPrice: 19000, referencePrice: 22000 },
      { id: "rb-400", label: "400 Robux", note: "Populer", sellingPrice: 73000, referencePrice: 80000 },
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
      { id: "steam-12", label: "Steam Wallet IDR 12.000", sellingPrice: 13500, referencePrice: 15000 },
      { id: "steam-45", label: "Steam Wallet IDR 45.000", sellingPrice: 48000, referencePrice: 52000 },
      { id: "steam-90", label: "Steam Wallet IDR 90.000", note: "Populer", sellingPrice: 95000, referencePrice: 102000 },
    ],
  },
];

// Fees stay zero in the MVP until the approved Midtrans merchant rate is known.
// The pricing engine already separates customer fees from merchant costs.
export const paymentMethods: PaymentMethod[] = [
  {
    id: "qris",
    name: "QRIS",
    detail: "Semua aplikasi pembayaran",
    customerFeeFlat: 0,
    customerFeePercent: 0,
    merchantFeeFlat: 0,
    merchantFeePercent: 0,
  },
  {
    id: "ewallet",
    name: "E-Wallet",
    detail: "GoPay, DANA, ShopeePay dan lainnya",
    customerFeeFlat: 0,
    customerFeePercent: 0,
    merchantFeeFlat: 0,
    merchantFeePercent: 0,
  },
  {
    id: "va",
    name: "Virtual Account",
    detail: "Transfer bank otomatis",
    customerFeeFlat: 0,
    customerFeePercent: 0,
    merchantFeeFlat: 0,
    merchantFeePercent: 0,
  },
];
