export type GamePackage = {
  id: string;
  label: string;
  note?: string;
  supplierCost: number;
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

// Seed prices for the MVP only. Production prices will be replaced by supplier sync.
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
      { id: "ml-5", label: "5 Diamonds", supplierCost: 1500, sellingPrice: 2000, referencePrice: 2500 },
      { id: "ml-12", label: "12 Diamonds", supplierCost: 3500, sellingPrice: 4500, referencePrice: 5000 },
      { id: "ml-28", label: "28 Diamonds", supplierCost: 7500, sellingPrice: 8500, referencePrice: 10000 },
      { id: "ml-86", label: "86 Diamonds", note: "Populer", supplierCost: 19500, sellingPrice: 21500, referencePrice: 24000 },
      { id: "ml-172", label: "172 Diamonds", supplierCost: 39000, sellingPrice: 42000, referencePrice: 47000 },
      { id: "ml-wdp", label: "Weekly Diamond Pass", note: "Hemat", supplierCost: 24000, sellingPrice: 27000, referencePrice: 31000 },
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
      { id: "ff-5", label: "5 Diamonds", supplierCost: 900, sellingPrice: 1500, referencePrice: 2000 },
      { id: "ff-20", label: "20 Diamonds", supplierCost: 3000, sellingPrice: 4000, referencePrice: 5000 },
      { id: "ff-50", label: "50 Diamonds", supplierCost: 6500, sellingPrice: 8000, referencePrice: 9000 },
      { id: "ff-100", label: "100 Diamonds", note: "Populer", supplierCost: 10000, sellingPrice: 12000, referencePrice: 14000 },
      { id: "ff-210", label: "210 Diamonds", supplierCost: 20500, sellingPrice: 23000, referencePrice: 26000 },
      { id: "ff-membership", label: "Weekly Membership", supplierCost: 26000, sellingPrice: 29000, referencePrice: 33000 },
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
      { id: "pubg-60", label: "60 UC", supplierCost: 14000, sellingPrice: 16000, referencePrice: 18000 },
      { id: "pubg-325", label: "325 UC", note: "Populer", supplierCost: 70000, sellingPrice: 76000, referencePrice: 85000 },
      { id: "pubg-660", label: "660 UC", supplierCost: 138000, sellingPrice: 147000, referencePrice: 160000 },
      { id: "pubg-1800", label: "1800 UC", supplierCost: 345000, sellingPrice: 365000, referencePrice: 395000 },
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
      { id: "valo-125", label: "125 Points", supplierCost: 14000, sellingPrice: 16000, referencePrice: 18000 },
      { id: "valo-420", label: "420 Points", note: "Populer", supplierCost: 43000, sellingPrice: 47000, referencePrice: 52000 },
      { id: "valo-700", label: "700 Points", supplierCost: 69000, sellingPrice: 74000, referencePrice: 81000 },
      { id: "valo-1375", label: "1375 Points", supplierCost: 135000, sellingPrice: 144000, referencePrice: 158000 },
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
      { id: "hok-16", label: "16 Tokens", supplierCost: 3000, sellingPrice: 4000, referencePrice: 5000 },
      { id: "hok-80", label: "80 Tokens", supplierCost: 14000, sellingPrice: 16000, referencePrice: 18000 },
      { id: "hok-240", label: "240 Tokens", note: "Populer", supplierCost: 41000, sellingPrice: 45000, referencePrice: 50000 },
      { id: "hok-weekly", label: "Weekly Card", supplierCost: 19000, sellingPrice: 22000, referencePrice: 25000 },
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
      { id: "gi-60", label: "60 Genesis Crystals", supplierCost: 13000, sellingPrice: 15000, referencePrice: 17000 },
      { id: "gi-300", label: "300 + 30 Crystals", supplierCost: 65000, sellingPrice: 70000, referencePrice: 77000 },
      { id: "gi-welkin", label: "Blessing of the Welkin Moon", note: "Populer", supplierCost: 59000, sellingPrice: 64000, referencePrice: 70000 },
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
      { id: "rb-50", label: "50 Robux", supplierCost: 8500, sellingPrice: 10000, referencePrice: 12000 },
      { id: "rb-100", label: "100 Robux", supplierCost: 17000, sellingPrice: 19000, referencePrice: 22000 },
      { id: "rb-400", label: "400 Robux", note: "Populer", supplierCost: 68000, sellingPrice: 73000, referencePrice: 80000 },
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
      { id: "steam-12", label: "Steam Wallet IDR 12.000", supplierCost: 12000, sellingPrice: 13500, referencePrice: 15000 },
      { id: "steam-45", label: "Steam Wallet IDR 45.000", supplierCost: 45000, sellingPrice: 48000, referencePrice: 52000 },
      { id: "steam-90", label: "Steam Wallet IDR 90.000", note: "Populer", supplierCost: 90000, sellingPrice: 95000, referencePrice: 102000 },
    ],
  },
];

// Fees stay zero in the MVP until the payment gateway is selected.
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
