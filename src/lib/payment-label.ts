// Maps raw provider payment-type codes (e.g. Midtrans `bank_transfer`) to
// customer-friendly Indonesian labels. Never render the raw code in the UI.
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
  return PAYMENT_TYPE_LABELS[key] ?? value.replace(/[_-]+/g, " ");
}
