import type { PublicPricingResult } from "@/lib/public-pricing";

export type PreviewOrder = {
  id: string;
  createdAt: string;
  mode: "preview";
  status: "waiting_payment";
  product: {
    gameId: string;
    gameName: string;
    shortName: string;
    packageId: string;
    packageLabel: string;
    accent: string;
    initials: string;
  };
  account: {
    userId: string;
    serverId?: string;
  };
  payment: {
    id: string;
    name: string;
    detail: string;
  };
  pricing: PublicPricingResult;
  promoCode?: string;
  referralCode?: string;
};

export function createPreviewOrderId(now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NBH-${date}-${suffix}`;
}

export function previewOrderStorageKey(orderId: string) {
  return `nambah:preview-order:${orderId}`;
}
