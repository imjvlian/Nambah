export type PublicOrderStatus =
  | "pending_payment"
  /*
   * Jalur merchant ritel. Dua status ini hanya muncul di order yang dibuat
   * lewat `merchant_retail` — tidak ada order Midtrans/DOKU yang memakainya.
   *
   * `pending_merchant` = user sudah checkout, merchant belum scan.
   * `awaiting_receivable` = sudah difulfill, tinggal merchant transfer.
   */
  | "pending_merchant"
  | "awaiting_receivable"
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
  expiresAt?: string | null;
  statusChangedAt?: string | null;
  terminalAt?: string | null;
  mode: "midtrans-sandbox" | "midtrans-production";
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
    provider: "midtrans" | "doku";
    providerStatus: string;
    paymentType: string | null;
    snapToken: string | null;
    redirectUrl: string | null;
    paidAt: string | null;
    providerTransactionId?: string | null;
  };
  /** Sesi DOKU (mis. konten QRIS) untuk dirender inline di halaman order. */
  doku?: {
    qrContent?: string;
    expiresAt?: string | null;
    /** Jokul Checkout JS — modal pembayaran di halaman Nambah (mode checkout). */
    checkoutJsUrl?: string;
  } | null;
  pricing: {
    sellingPrice: number;
    promotionDiscount: number;
    referralDiscount: number;
    pointsDiscount: number;
    pointsRedeemed: number;
    pointsEarned: number;
    customerPaymentFee: number;
    finalPrice: number;
  };
  promoCode?: string;
  referralCode?: string;
  // SN supplier (bukti pembelian, mis. SN pulsa/token). Hanya diisi saat
  // order berstatus `success`; sengaja tidak diekspos pada status lain.
  serialNumber?: string | null;
};
