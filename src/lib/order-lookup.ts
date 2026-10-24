import { normalizeReceiptWhatsapp } from "@/lib/customer-contact";

/**
 * Pemulihan akses order untuk tamu (P4.2, 24 Okt 2026).
 *
 * Masalah: tamu hanya bisa membuka ordernya lewat link ber-token. Kalau
 * link itu hilang (tab ditutup, WA terhapus, email tidak sampai), ordernya
 * praktis hilang — padahal uangnya bisa saja sudah masuk.
 *
 * Desain verifikasi: Order ID + SATU kontak yang pelanggan isi sendiri
 * saat checkout (email atau WhatsApp). Order ID saja TIDAK cukup — ID
 * berpola tanggal sehingga bisa ditebak; kontaknya adalah faktor kedua
 * yang hanya pelanggan asli tahu.
 *
 * Kegagalan pencocokan TIDAK membedakan "order tidak ada" dan "kontak
 * tidak cocok" — pesan yang sama untuk keduanya supaya endpoint ini
 * tidak jadi alat mengonfirmasi keberadaan order milik orang lain.
 */

/** Pola Order ID hasil createOrderId: NBH-YYYYMMDD-10 karakter. */
export const ORDER_ID_PATTERN = /^NBH-\d{8}-[A-Z0-9]{10}$/;

export type OrderLookupContactRow = {
  receipt_email: string | null;
  receipt_whatsapp: string | null;
};

/**
 * Apakah kontak yang diketik cocok dengan order ini — MURNI.
 *
 * Kontak ber-@ dibandingkan sebagai email (case-insensitive); sisanya
 * dinormalisasi sebagai nomor WhatsApp Indonesia (08… → 62…), memakai
 * normalizer yang sama dengan checkout supaya format yang diketik
 * pelanggan tidak pernah jadi penghalang.
 */
export function orderLookupContactMatches(
  contact: string,
  order: OrderLookupContactRow,
): boolean {
  const trimmed = contact.trim();
  if (!trimmed) return false;

  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return (order.receipt_email ?? "").trim().toLowerCase() === email;
  }

  const whatsapp = normalizeReceiptWhatsapp(trimmed);
  if (!whatsapp) return false;
  return normalizeReceiptWhatsapp(order.receipt_whatsapp ?? "") === whatsapp;
}

/** Pesan galat generik — sengaja sama untuk semua jenis kegagalan. */
export const ORDER_LOOKUP_MISMATCH_MESSAGE =
  "Pesanan tidak ditemukan atau data kontak tidak cocok. Pastikan Anda memakai Order ID dan email/WhatsApp yang sama dengan saat checkout.";
