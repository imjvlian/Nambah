/*
 * Icon logonya tiap kanal pembayaran di kartu checkout (28 Okt 2026).
 *
 * Sumber aset:
 *   - go-pay/dana/ovo/shopee-pay.svg — sudah ada di repo (wordmark
 *     horizontal, viewBox ~382x109).
 *   - qris.svg — logo resmi QRIS dari Wikimedia Commons (CC0,
 *     File:QRIS_Logo.svg), unduh via Special:FilePath.
 *   - bca.png / bni.svg / bri.svg / mandiri.svg / permata.svg — logo bank
 *     dari Wikimedia Commons (Special:FilePath), rilis kartu grup.
 * Kanal tanpa aset digantai chip warna akronim (fallback, bandingkan
 * `.pay-chip` pada CSS). Baris non-aktif (indomaret/alfamart/kartu) tidak
 * dirender di checkout, tapi map ini tetap menyiapkan chipnya.
 */

const LOGO_ASSETS: Record<string, string> = {
  qris: "/product-assets/brands/qris.svg",
  gopay: "/product-assets/brands/go-pay.svg",
  shopeepay: "/product-assets/brands/shopee-pay.svg",
  dana: "/product-assets/brands/dana.svg",
  ovo: "/product-assets/brands/ovo.svg",
  bca_va: "/product-assets/brands/bca.png",
  bni_va: "/product-assets/brands/bni.svg",
  bri_va: "/product-assets/brands/bri.svg",
  permata_va: "/product-assets/brands/permata.svg",
  echannel: "/product-assets/brands/mandiri.svg",
};

type BankChip = { background: string; color: string; label: string };

/* Fallback chip: bank tanpa aset — warna identitas bank + akronim. */
const BANK_CHIPS: Record<string, BankChip> = {
  bca_va: { background: "#0d2f81", color: "#ffffff", label: "BCA" },
  bni_va: { background: "#f37021", color: "#ffffff", label: "BNI" },
  bri_va: { background: "#0455a4", color: "#ffffff", label: "BRI" },
  permata_va: { background: "#00417d", color: "#ffffff", label: "PERMATA" },
  echannel: { background: "#1c355e", color: "#ffffff", label: "MANDIRI" },
  indomaret: { background: "#0442aa", color: "#ffffff", label: "INDO" },
  alfamart: { background: "#e21b22", color: "#ffffff", label: "ALFA" },
  credit_card: { background: "#3a3f37", color: "#ffffff", label: "KARTU" },
};

export default function PaymentMethodIcon({ id }: { id: string }) {
  const asset = LOGO_ASSETS[id];
  if (asset) {
    return (
      <span className="pay-logo">
        <img src={asset} alt="" loading="lazy" />
      </span>
    );
  }
  const chip = BANK_CHIPS[id];
  if (chip) {
    return (
      <span
        className="pay-chip"
        style={{ background: chip.background, color: chip.color }}
      >
        {chip.label}
      </span>
    );
  }
  return (
    <span className="pay-chip" style={{ background: "#3a3f37", color: "#fff" }}>
      {id.replace(/_/g, " ").toUpperCase()}
    </span>
  );
}
