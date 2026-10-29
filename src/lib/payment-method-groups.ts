/*
 * Pengelompokan metode pembayaran di checkout (28 Okt 2026, keputusan owner):
 *   - Daftar per-kanal dari DB (migrasi 061) ditampilkan dalam GRUP:
 *     QRIS / E-Wallet / Virtual Account — tiap kanal berupa kartu kecil
 *     dengan icon logonya (lihat PaymentMethodIcon.tsx).
 *   - Konvensi id baris: qris → QRIS; gopay/shopeepay/dana/ovo → E-Wallet;
 *     suffix `_va` atau `echannel` → Virtual Account; indomaret/alfamart →
 *     Minimarket; sisanya → Lainnya.
 *   - DB tetap sumber kebenaran isi daftar; pengelompokan ini hanya menata
 *     tampilan. Baris baru dari admin otomatis masuk grup yang sesuai
 *     konvensi id-nya, tanpa perubahan kode.
 */

export type PaymentGroupLabel =
  | "QRIS"
  | "E-Wallet"
  | "Virtual Account"
  | "Minimarket"
  | "Lainnya";

const GROUP_ORDER: PaymentGroupLabel[] = [
  "QRIS",
  "E-Wallet",
  "Virtual Account",
  "Minimarket",
  "Lainnya",
];

const EWALLET_IDS = new Set(["gopay", "shopeepay", "dana", "ovo"]);
const RETAIL_IDS = new Set(["indomaret", "alfamart"]);

/*
 * Baris genus legacy (migrasi 061 menonaktifkannya, tapi DB belum tentu
 * sudah di-migrasi) dipetakan ke grup yang wajar:
 *   - `ewallet` → E-Wallet
 *   - `va`      → Virtual Account
 * Tanpa ini, keduanya jatuh ke grup "Lainnya" dan user melihat bucket
 * generik di checkout padahal isinya jelas e-wallet / virtual account.
 */
const LEGACY_GROUP_BY_ID: Record<string, PaymentGroupLabel> = {
  ewallet: "E-Wallet",
  va: "Virtual Account",
};

export function paymentGroupOf(id: string): PaymentGroupLabel {
  if (!id) return "Lainnya";
  if (id === "qris") return "QRIS";
  if (EWALLET_IDS.has(id)) return "E-Wallet";
  if (id.endsWith("_va") || id === "echannel") return "Virtual Account";
  if (RETAIL_IDS.has(id)) return "Minimarket";
  const legacy = LEGACY_GROUP_BY_ID[id];
  if (legacy) return legacy;
  return "Lainnya";
}

export type PaymentMethodLike = { id: string };

export type GroupedPaymentMethods<T extends PaymentMethodLike> = {
  label: PaymentGroupLabel;
  methods: T[];
};

/*
 * Urutan grup mengikuti GROUP_ORDER; dalam grup, urutan DB (sort_order)
 * dipertahankan. Grup kosong dilewati.
 */
export function groupPaymentMethods<T extends PaymentMethodLike>(
  methods: T[],
): GroupedPaymentMethods<T>[] {
  const buckets = new Map<PaymentGroupLabel, T[]>();
  for (const method of methods) {
    const label = paymentGroupOf(method.id);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(method);
    else buckets.set(label, [method]);
  }
  return GROUP_ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    methods: buckets.get(label)!,
  }));
}
