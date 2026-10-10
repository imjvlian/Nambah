import "server-only";

import { supabaseSelect } from "@/lib/supabase/server";
import { normalizeScanCode } from "@/lib/merchant-scan-code";

/**
 * Pencarian order merchant untuk kasir — READ ONLY, tanpa efek samping.
 *
 * Kenapa lookup harus terpisah dari confirm:
 *
 * Memproses kode yang salah berarti menagih top up orang yang tidak ada di
 * depan kasir, dan top up-nya sudah irreversibel di sisi supplier. Jadi
 * kasir selalu punya kesempatan melihat pratinjau dulu — nama toko, paket,
 * nominal, ID akun tujuan — dan mengonfirmasi dengan customer yang berdiri
 * di depannya sebelum apa pun dijalankan.
 *
 * Modul ini TIDAK pernah mengubah status apa pun.
 */

export type MerchantLookupResult =
  | {
      found: true;
      orderId: string;
      merchantName: string;
      /** Harga katalog + biaya layanan — yang harus dibayar customer. */
      amount: number;
      /** Biaya layanan merchant, ditampilkan terpisah di pratinjau. */
      serviceFee: number;
      packageLabel: string;
      gameName: string;
      /** Disembunyikan sebagian supaya kasir tidak salah konfirmasi. */
      targetUserId: string;
      status: string;
      expiresAt: string | null;
      /** Alasan kalau order tidak bisa dijalankan (bahasa untuk kasir). */
      blockedReason: string | null;
    }
  | {
      found: false;
      /** HTTP status yang layak dikembalikan. */
      status: number;
      /** Pesan yang AMAN dibaca kasir di depan customer. */
      reason: string;
      code:
        | "invalid_code"
        | "order_not_found"
        | "wrong_merchant"
        | "merchant_disabled";
    };

/**
 * Cari order berdasarkan kode pindai.
 *
 * `merchantId` wajib. Tanpa itu, siapa pun yang punya perangkat kasir bisa
 * mengetik kode sembarang dan melihat pratinjau order milik toko lain —
 * termasuk ID akun tujuan customer dan nominal yang akan ditagih.
 */
export async function lookupMerchantScanCode(
  rawCode: string,
  merchantId: string,
): Promise<MerchantLookupResult> {
  const code = normalizeScanCode(rawCode);

  if (!code) {
    /*
     * Kode yang tidak bisa diformat adalah salah ketik, bukan kode asing.
     * Kasir perlu tahu bedanya, kalau tidak dia akan mengira ordernya
     * benar-benar tidak ada.
     */
    return {
      found: false,
      status: 400,
      reason: "Format kode tidak dikenali. Kode berbentuk MR7K2-X9Q.",
      code: "invalid_code",
    };
  }

  const rows = await supabaseSelect<LookupRow>("orders", {
    select:
      "id,merchant_id,status,final_price,service_fee_amount,expires_at,merchant_scan_code,target_user_id,products!left(label),games!left(name),merchants!left(name)",
    filters: { merchant_scan_code: `eq.${code}` },
    limit: 1,
  });

  const row = rows[0];
  if (!row) {
    return {
      found: false,
      status: 404,
      reason: "Kode tidak ditemukan. Minta pelanggan memeriksa layar pesanannya.",
      code: "order_not_found",
    };
  }

  if (row.merchant_id !== merchantId) {
    return {
      found: false,
      status: 403,
      reason: "Kode ini bukan untuk toko Anda.",
      code: "wrong_merchant",
    };
  }

  const amount = Number(row.final_price) || 0;
  const serviceFee = Number(row.service_fee_amount ?? 0) || 0;

  /*
   * Pratinjau TETAP dikembalikan untuk order yang tidak bisa dijalankan.
   *
   * Kasir yang melihat "sudah dipindai" untuk order yang sedang berdiri di
   * depannya punya informasi yang berguna: pesan apa yang harus dikatakan ke
   * customer. Menolak dengan 409 dan pesan kosong akan membuatnya mengira
   * ada yang salah dengan kodenya, lalu mencoba mengetik ulang.
   */
  return {
    found: true,
    orderId: row.id,
    merchantName: relatedName(row.merchants) ?? "",
    amount,
    serviceFee,
    packageLabel: relatedName(row.products, "label") ?? "",
    gameName: relatedName(row.games) ?? "",
    targetUserId: maskTargetUserId(row.target_user_id),
    status: row.status,
    expiresAt: row.expires_at,
    blockedReason: blockedReasonFor(row.status, row.expires_at),
  };
}

type LookupRow = {
  id: string;
  merchant_id: string | null;
  status: string;
  final_price: number | string;
  service_fee_amount: number | string | null;
  expires_at: string | null;
  merchant_scan_code: string | null;
  target_user_id: string;
  merchants: unknown;
  products: unknown;
  games: unknown;
};

/**
 * PostgREST mengirim relasi Foreign Key sebagai objek saat relasi satu-ke-satu, atau array
 * saat satu-ke-banyak. `merchants` dan `products` di sini keduanya relasi satu-ke-satu
 * dari sisi `orders`, tapi bentuk jawabannya tidak dijamin lintas versi —
 * karena itu dinormalisasi di satu tempat.
 */
function relatedName(value: unknown, key: "name" | "label" = "name"): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return null;
  const record = first as Record<string, unknown>;
  const picked = record[key];
  return typeof picked === "string" ? picked : null;
}

/**
 * Samarkan ID akun tujuan.
 *
 * Kasir tidak butuh ID lengkap untuk memproses - cukup memastikan nomornya
 * sama dengan yang customer sebutkan. Menampilkannya utuh di perangkat yang
 * bisa dibawa siapa saja menambah risiko kebocoran tanpa manfaat apa pun.
 */
function maskTargetUserId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${"*".repeat(3)}${trimmed.slice(-4)}`;
}

/**
 * Alasan kalau order tidak bisa dijalankan, dalam bahasa kasir.
 *
 * Status yang DISEBUKKAN di sini persis sama dengan yang dipakai
 * `confirmMerchantScan`. Kalau keduanya berbeda, kasir akan melihat
 * "kode tidak ditemukan" di satu layar dan "sudah dipindai" di berikutnya
 * untuk order yang sama.
 */
function blockedReasonFor(status: string, expiresAt: string | null): string | null {
  if (status === "pending_merchant") {
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return "Kode sudah kedaluwarsa. Minta pelanggan membuat pesanan baru.";
    }
    return null;
  }

  if (status === "paid" || status === "processing" || status === "success") {
    return "Pesanan ini sudah dipindai sebelumnya.";
  }

  return "Pesanan ini tidak dalam status yang bisa dipindai.";
}