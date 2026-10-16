/**
 * Centralised customer-facing copy.
 *
 * Aturan: string di sini hanya boleh berisi informasi yang aman untuk dibaca
 * pembeli. Detail internal (nama profit/margin, provider, environment, kode
 * error mentah pihak ketiga) TIDAK BOLEH masuk ke file ini — catat di server
 * lalu kirim kode generiknya ke user.
 */

export type RejectionCode =
  | "promo_minimum_order"
  | "referral_minimum_order"
  | "referral_not_stackable"
  | "points_exceed_subtotal"
  | "profit_below_minimum"
  | "referral_margin_too_thin";

/**
 * Copy untuk penolakan checkout yang penyebabnya murni internal (margin, profit,
 * biaya supplier). Jangan pernah menyebut angka vagy istilah bisnis di sini.
 */
const INTERNAL_REJECTION_COPY: Record<
  Extract<RejectionCode, "profit_below_minimum" | "referral_margin_too_thin">,
  string
> = {
  profit_below_minimum:
    "Kode ini belum bisa dipakai untuk produk ini. Coba checkout tanpa kodenya, ya.",
  referral_margin_too_thin:
    "Referral ini belum bisa dipakai untuk produk ini. Coba checkout tanpa kodenya, ya.",
};

/**
 * Copy untuk penolakan yang aman dan helpful untuk customer.
 * `context` dipakai untuk menyisipkan detail yang memang milik user
 * (mis. kode promo dan minimum belanja), bukan data bisnis internal.
 */
const CUSTOMER_REJECTION_COPY: Record<
  Exclude<RejectionCode, "profit_below_minimum" | "referral_margin_too_thin">,
  (context: {
    code?: string;
    otherCode?: string;
    /** Sudah diformat sebagai rupiah oleh pemanggil. */
    minimumOrder?: string | number;
  }) => string
> = {
  promo_minimum_order: ({ code, minimumOrder }) =>
    `Kode ${code} bisa dipakai mulai belanja ${minimumOrder}.`,

  referral_minimum_order: ({ code, minimumOrder }) =>
    `Referral ${code} bisa dipakai mulai belanja ${minimumOrder}.`,

  referral_not_stackable: ({ code, otherCode }) =>
    `Referral ${code} nggak bisa dipakai bareng promo ${otherCode}. Pilih salah satu ya.`,

  points_exceed_subtotal: () =>
    "Points-nya kebanyakan. Kurangi biar totalnya pas.",
};

export function rejectionCodeCopy(
  code: RejectionCode,
  context?: {
    code?: string;
    otherCode?: string;
    minimumOrder?: string | number;
  },
): string {
  if (code === "profit_below_minimum" || code === "referral_margin_too_thin") {
    return INTERNAL_REJECTION_COPY[code];
  }
  return CUSTOMER_REJECTION_COPY[code](context ?? {});
}
