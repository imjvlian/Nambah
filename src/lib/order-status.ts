import type { PublicOrderStatus } from "./order-public";
import { BRAND } from "@/lib/brand";

/** Customer-facing status copy and CTA definitions */
export const STATUS_LABEL: Record<PublicOrderStatus, string> = {
  pending_payment: "Menunggu pembayaran",
  pending_merchant: "Menunggu konfirmasi toko",
  awaiting_receivable: "Selesai - menunggu pembayaran toko",
  paid: "Pembayaran diterima",
  processing: "Sedang diproses",
  success: "Top up berhasil",
  failed: "Pesanan gagal",
  refunded: "Dana dikembalikan",
  cancelled: "Pembayaran dibatalkan",
};

export const STATUS_DESCRIPTION: Record<PublicOrderStatus, string> = {
  pending_payment:
    "Silakan selesaikan pembayaran di bawah. Order akan kedaluwarsa dalam 30 menit.",
  pending_merchant:
    "Pembayaran sudah diterima toko. Tinggal tunjukkan layar ini ke kasir agar pesanan langsung diproses.",
  awaiting_receivable:
    "Top up sudah berhasil. Toko akan menerima pembayaran paling lambat 7 hari ke depan.",
  paid: "Pembayaran Anda telah diterima dan sedang diverifikasi.",
  processing: "Pesanan Anda sedang diteruskan ke penyedia layanan.",
  success: `Top up telah berhasil diproses. Terima kasih telah menggunakan ${BRAND.shortName}.`,
  failed: "Pembayaran gagal atau ditolak. Anda dapat membuat pesanan baru.",
  refunded: "Pembayaran telah dikembalikan ke sumber dana asli.",
  cancelled: "Pembayaran dibatalkan atau kedaluwarsa. Silakan buat pesanan baru.",
};

export type StatusAction = "copy" | "pay" | "refresh" | "new_order" | "support";

export const STATUS_CTA: Record<PublicOrderStatus, { label: string; action: StatusAction }[]> = {
  pending_payment: [
    { label: "Salin Order ID", action: "copy" },
    { label: "Buka pembayaran", action: "pay" },
    { label: "Periksa status", action: "refresh" },
  ],
  /*
   * TIDAK ada aksi "pay" di sini, dan itu disengaja.
   *
   * Order ritel tidak punya sesi payment gateway sama sekali — user sudah
   * membayar di konter. Menampilkan tombol "Buka pembayaran" akan mengirim
   * user ke halaman pembayaran yang tidak ada isinya, atau lebih buruk,
   * membuatnya mengira transaksinya belum jalan.
   */
  pending_merchant: [
    { label: "Salin Order ID", action: "copy" },
    { label: "Periksa status", action: "refresh" },
  ],
  awaiting_receivable: [
    { label: "Salin Order ID", action: "copy" },
    { label: "Top up lagi", action: "new_order" },
  ],
  paid: [
    { label: "Periksa status", action: "refresh" },
    { label: "Salin Order ID", action: "copy" },
  ],
  processing: [
    { label: "Periksa status", action: "refresh" },
    { label: "Salin Order ID", action: "copy" },
  ],
  success: [
    { label: "Top up lagi", action: "new_order" },
    { label: "Salin Order ID", action: "copy" },
  ],
  failed: [
    { label: "Buat pesanan baru", action: "new_order" },
    { label: "Hubungi bantuan", action: "support" },
    { label: "Salin Order ID", action: "copy" },
  ],
  refunded: [
    { label: "Top up lagi", action: "new_order" },
    { label: "Salin Order ID", action: "copy" },
  ],
  cancelled: [
    { label: "Buat pesanan baru", action: "new_order" },
    { label: "Salin Order ID", action: "copy" },
  ],
};

export const TIMELINE_STEPS: { title: string; description: string; status: PublicOrderStatus }[] = [
  { title: "Pesanan dibuat", description: "Menunggu pembayaran Anda", status: "pending_payment" },
  { title: "Pembayaran diterima", description: "Transaksi diverifikasi oleh sistem", status: "paid" },
  { title: "Sedang diproses", description: "Diteruskan ke penyedia layanan", status: "processing" },
  { title: "Top up berhasil", description: "Saldo telah dikirim ke akun Anda", status: "success" },
];

/*
 * Timeline khusus jalur ritel.
 *
 * Berbeda dengan `TIMELINE_STEPS`, tidak ada "Transaksi diverifikasi oleh
 * sistem" — tidak ada sistem yang memverifikasi apa pun di sini. Yang
 * memindahkan pesanan maju adalah orang: kasir yang scan.
 *
 * Memberi timeline generik ke order ritel akan menampilkan "diverifikasi
 * sistem" padahal yang sebenarnya terjadi adalah seorang kasir menekan
 * tombol, dan itu akan terasa aneh kalau customer berdiri di depan mereka.
 */
export const MERCHANT_TIMELINE_STEPS: {
  title: string;
  description: string;
  status: PublicOrderStatus;
}[] = [
  { title: "Pesanan dibuat", description: "Pembayaran diterima toko", status: "pending_merchant" },
  { title: "Sedang diproses", description: "Toko sedang memproses pesanan", status: "processing" },
  { title: "Top up berhasil", description: "Saldo telah dikirim ke akun Anda", status: "success" },
];

/** Terminal status set for quick checks */
export const TERMINAL_STATUSES: ReadonlySet<PublicOrderStatus> = new Set([
  "success",
  "failed",
  "refunded",
  "cancelled",
]);

export function isTerminalStatus(s: PublicOrderStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

/** Type for countdown calculation results */
export type CountdownResult = {
  display: string;
  isExpired: boolean;
  totalSeconds: number;
};

export function calculateCountdown(expiresAt?: string | null): CountdownResult {
  if (!expiresAt) {
    return { display: "--", isExpired: false, totalSeconds: 0 };
  }

  const expiresAtDate = new Date(expiresAt);
  if (Number.isNaN(expiresAtDate.getTime())) {
    return { display: "--", isExpired: false, totalSeconds: 0 };
  }

  const now = new Date();
  const diffMs = expiresAtDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { display: "0", isExpired: true, totalSeconds: 0 };
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const display = formatCountdown(totalSeconds);

  return { display, isExpired: false, totalSeconds };
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  return seconds.toString();
}