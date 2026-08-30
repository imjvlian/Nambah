import type { GamePackage } from "@/lib/catalog";

export type SupplierPricedPackage = GamePackage & {
  supplierCost: number;
};

// MVP-only private supplier seed. This module must only be imported from server code.
// Digiflazz price sync will replace this map in the backend milestone.
const supplierCostByPackageId: Record<string, number> = {
  "ml-5": 1500,
  "ml-12": 3500,
  "ml-28": 7500,
  "ml-86": 19500,
  "ml-172": 39000,
  "ml-wdp": 24000,
  "ff-5": 900,
  "ff-20": 3000,
  "ff-50": 6500,
  "ff-100": 10000,
  "ff-210": 20500,
  "ff-membership": 26000,
  "pubg-60": 14000,
  "pubg-325": 70000,
  "pubg-660": 138000,
  "pubg-1800": 345000,
  "valo-125": 14000,
  "valo-420": 43000,
  "valo-700": 69000,
  "valo-1375": 135000,
  "hok-16": 3000,
  "hok-80": 14000,
  "hok-240": 41000,
  "hok-weekly": 19000,
  "gi-60": 13000,
  "gi-300": 65000,
  "gi-welkin": 59000,
  "rb-50": 8500,
  "rb-100": 17000,
  "rb-400": 68000,
  "steam-12": 12000,
  "steam-45": 45000,
  "steam-90": 90000,
};

export function attachSupplierCost(item: GamePackage): SupplierPricedPackage | null {
  const supplierCost = supplierCostByPackageId[item.id];
  if (supplierCost === undefined) return null;
  return { ...item, supplierCost };
}
