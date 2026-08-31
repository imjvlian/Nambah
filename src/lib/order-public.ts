export type PublicOrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "success"
  | "failed"
  | "refunded"
  | "cancelled";

export type PublicOrder = {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: "midtrans-sandbox";
  status: PublicOrderStatus;
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
    provider: "midtrans";
    providerStatus: string;
    paymentType: string | null;
    snapToken: string | null;
    redirectUrl: string | null;
    paidAt: string | null;
  };
  pricing: {
    sellingPrice: number;
    promotionDiscount: number;
    referralDiscount: number;
    customerPaymentFee: number;
    finalPrice: number;
  };
  promoCode?: string;
  referralCode?: string;
};
