import type { PublicOrderStatus } from "@/lib/order-public";

/**
 * "Coba lagi" untuk order gagal/kedaluwarsa (P3.2, 24 Okt 2026).
 *
 * Masalah: tombol "Buat pesanan baru" hanya melempar ke beranda —
 * pelanggan mengulang semuanya dari nol: pilih game, pilih paket,
 * ketik ulang ID game + server, kode promo, kode referral. Padahal
 * semua data itu sudah ada di halaman order-nya.
 *
 * Desain: PREFILL, bukan auto-beli.
 *   - Halaman order menulis data order lama ke sessionStorage,
 *     lalu navigasi ke etalase; TopupExperience membacanya sekali
 *     saat mount, mengisi form, menghapus.
 *   - sessionStorage, bukan query param: ID game tidak bocor ke
 *     URL, riwayat browser, atau analytics.
 *   - Pelanggan tetap melihat HARGA TERKINI dan menekan bayar
 *     sendiri — semua gate jalan seperti biasa (verifikasi akun,
 *     maintenance, idempotency). Kalau produk sudah hilang atau
 *     harganya berubah, dia melihat kenyataannya sebelum bayar.
 *
 * Kunci uang — `paid_at`:
 *   - Order `failed` bisa berarti dua hal: bayar DITOLAK (uang tidak
 *     pernah keluar) atau fulfillment GAGAL SETELAH bayar (uang
 *     tertahan sampai refund). "Coba lagi" hanya aman untuk yang
 *     pertama; untuk yang kedua itu berarti bayar dua kali.
 */

/** Kunci sessionStorage untuk prefill. */
export const RETRY_PREFILL_STORAGE_KEY = "nambah_retry_prefill";

export type RetryPrefill = {
  gameId: string;
  packageId: string;
  userId: string;
  serverId?: string;
  promoCode?: string;
  referralCode?: string;
};

/** Bentuk minimal yang dibutuhkan fungsi-fungsi di file ini. */
export type RetrySource = {
  status: PublicOrderStatus;
  /** payment.paidAt — momen gateway menyelesaikan pembayaran. */
  paidAt: string | null;
  product: {
    gameId: string;
    packageId: string;
  };
  account: {
    userId: string;
    serverId?: string;
  };
  promoCode?: string | null;
  referralCode?: string | null;
};

/**
 * Apakah menawarkan "Coba lagi" AMAN untuk order ini — artinya tidak
 * ada uang pelanggan yang sedang tertahan di order tersebut.
 *
 * - `cancelled`, `refunded`, `success`, `awaiting_receivable`:
 *   transaksi sudah tuntas satu arah atau lainnya — tidak ada uang
 *   yang bisa dobel.
 * - `failed` TANPA paidAt: bayar ditolak/kedaluwarsa — tidak ada
 *   uang keluar, coba lagi gratis.
 * - `failed` DENGAN paidAt: pelanggan sudah membayar dan fulfillment
 *   gagal — uangnya tertahan sampai refund. Menawarkan "coba lagi"
 *   di sini menggoda bayar dua kali; jalurnya refund.
 */
export function isRetrySafeOrder(order: {
  status: PublicOrderStatus;
  paidAt: string | null;
}): boolean {
  switch (order.status) {
    case "cancelled":
    case "refunded":
    case "success":
    case "awaiting_receivable":
      return true;
    case "failed":
      return order.paidAt == null;
    default:
      return false;
  }
}

/**
 * Label tombol untuk aksi "new_order" — beda label, satu perilaku
 * (semuanya prefill + navigasi; label memberi tahu pelanggan apa yang
 * akan terjadi dengan uangnya).
 */
export function retryCTALabel(order: {
  status: PublicOrderStatus;
  paidAt: string | null;
}): string {
  switch (order.status) {
    case "failed":
      return order.paidAt == null ? "Coba lagi" : "Buat pesanan baru";
    case "cancelled":
      return "Coba lagi";
    case "success":
    case "refunded":
    case "awaiting_receivable":
      return "Top up lagi";
    default:
      return "Buat pesanan baru";
  }
}

/**
 * Data prefill dari order lama — MURNI, tanpa storage.
 *
 * Kode promo/referral hanya mengisi kolom input, TIDAK auto-apply:
 * kode yang sudah kedaluwarsa akan mematikan seluruh pratinjau harga
 * kalau di-apply buta; lewat tombol "Terapkan" yang ada, validasinya
 * jalan dengan pesan yang jujur dan harga dasar tetap tampil.
 */
export function buildRetryPrefill(order: RetrySource): RetryPrefill {
  return {
    gameId: order.product.gameId,
    packageId: order.product.packageId,
    userId: order.account.userId,
    ...(order.account.serverId ? { serverId: order.account.serverId } : {}),
    ...(order.promoCode ? { promoCode: order.promoCode } : {}),
    ...(order.referralCode ? { referralCode: order.referralCode } : {}),
  };
}

/**
 * Tulis prefill ke sessionStorage — best-effort.
 *
 * Gagal storage (mode privat, storage penuh) TIDAK boleh menggagalkan
 * navigasi: prefill itu kenyamanan, bukan prasyarat.
 */
export function stowRetryPrefill(order: RetrySource): boolean {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    window.sessionStorage.setItem(
      RETRY_PREFILL_STORAGE_KEY,
      JSON.stringify(buildRetryPrefill(order)),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Baca + HAPUS prefill sekali — dipakai TopupExperience saat mount.
 *
 * Sekali pakai dengan sengaja: kalau pelanggan mengubah pilihannya
 * lalu refresh, dia tidak mau dikembalikan ke prefill lama.
 */
export function takeRetryPrefill(): RetryPrefill | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(RETRY_PREFILL_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(RETRY_PREFILL_STORAGE_KEY);

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.gameId !== "string" || !parsed.gameId) return null;
    if (typeof parsed.packageId !== "string" || !parsed.packageId) return null;
    if (typeof parsed.userId !== "string" || !parsed.userId) return null;

    const optionalString = (key: string): string | undefined => {
      const value = parsed[key];
      return typeof value === "string" && value ? value : undefined;
    };

    return {
      gameId: parsed.gameId,
      packageId: parsed.packageId,
      userId: parsed.userId,
      serverId: optionalString("serverId"),
      promoCode: optionalString("promoCode"),
      referralCode: optionalString("referralCode"),
    };
  } catch {
    return null;
  }
}
