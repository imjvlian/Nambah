// Maps raw provider payment-type codes (e.g. Midtrans `bank_transfer`) to
// customer-friendly Indonesian labels. Never render the raw code in the UI —
// unmapped codes fall back to a generic label and are logged server-side.
const PAYMENT_TYPE_LABELS: Record<string, string> = {
  bank_transfer: "Transfer Bank",
  echannel: "Mandiri Bill",
  cstore: "Gerai Retail",
  credit_card: "Kartu Kredit",
  gopay: "GoPay",
  shopeepay: "ShopeePay",
  dana: "DANA",
  ovo: "OVO",
  qris: "QRIS",
  other_qris: "QRIS",
  akulaku: "Akulaku",
  kredivo: "Kredivo",
};

export function paymentTypeLabel(value?: string | null): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;

  const known = PAYMENT_TYPE_LABELS[key];
  if (known) return known;

  // Midtrans menambah kode baru tanpa notice. Tanpa ini, kode mentah seperti
  // "shopeepay_va" atau "mandiri_va" bocor ke UI sebagai teks teknis.
  // Render label generik yang jujur, lalu log nilainya di server.
  console.warn(`Unmapped Midtrans payment_type "${key}" — add label to payment-label.ts`);
  return "Metode pembayaran";
}
