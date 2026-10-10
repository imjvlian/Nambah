import "server-only";

import { randomInt } from "node:crypto";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import {
  getOrderForMerchantScan,
  type MerchantScanOrder,
} from "@/lib/merchant-retail";
import {
  SCAN_ALPHABET_SIZE,
  generateScanCodeFrom,
  normalizeScanCode,
} from "@/lib/merchant-scan-code";

/**
 * Generate kode pindai yang benar-benar belum terpakai.
 *
 * Sekitar satu miliar kombinasi membuat tabrakan sangat tidak mungkin secara
 * praktis, tapi "tidak mungkin" bukan "tidak pernah" - dan order yang gagal
 * dibuat karena tabrakan akan hilang begitu saja, tanpa jejak. Jadi kodenya
 * diperiksa dulu dengan query sebelum dipakai.
 *
 * Retry dibatasi 5 kali. Kalau lima kali berturut-turut gagal, itu berarti
 * sesuatu yang salah secara struktural (misalnya alfabet berubah jadi lebih
 * pendek dari yang di-hardcode di sini), dan lebih baik error terlihat
 * daripada mengulang tanpa henti.
 */
export async function allocateMerchantScanCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    /*
     * `randomInt` dibangun di atas rejection sampling, jadi hasilnya
     * terdistribusi merata. `Math.random() % n` akan sering mengorbankan
     * bilangan kecil - yang membuat kode bisa ditebak.
     *
     * Rentangnya INDEKS ALFABET, bukan [0,1). Lihat kontrak
     * `generateScanCodeFrom`: salah membaca rentangnya akan menghasilkan
     * kode "undefined" untuk semua order.
     */
    const code = generateScanCodeFrom(() => randomInt(0, SCAN_ALPHABET_SIZE));

    const taken = await supabaseSelect<{ id: string }>("orders", {
      select: "id",
      filters: { merchant_scan_code: `eq.${code}` },
      limit: 1,
    });

    if (taken.length === 0) return code;
  }

  throw new Error(
    "Gagal membuat kode pindai merchant yang unik setelah 5 percobaan.",
  );
}

/**
 * Konfirmasi order merchant saat kasir memindai kodenya.
 *
 * ALURNYA:
 *
 *   pending_merchant --(kasir scan)--> paid --(fulfillment)--> processing
 *
 * Yang dilakukan modul ini HANYA perpindahan status pertama. Fulfillment
 * dipanggil terpisah, bukan di dalam sini, supaya kegagalan top up tidak
 * membuat merchant mengira pemindaiannya gagal dan memindai ulang.
 *
 * Kenapa harus ada status `paid` di tengah: `fulfillPaidOrder` hanya menerima
 * order berstatus `paid` atau `processing`. Yang penting, scan itu sendiri
 * berarti "merchant sudah menerima uang user" - dan itu perlu terekam
 * terpisah dari "supplier sudah mengirim", karena kalau keduanya jadi satu
 * langkah, order yang gagal di supplier tidak bisa dibedakan dari order yang
 * belum pernah dibayar.
 */

export type MerchantScanRow = {
  id: string;
  merchant_id: string | null;
  status: string;
  final_price: number | string;
  expires_at: string | null;
};

export type ScanResult =
  | {
      ok: true;
      orderId: string;
      /** Nama toko, supaya kasir bisa konfirmasi ke customer. */
      merchantName: string;
      amount: number;
    }
  | {
      ok: false;
      /** HTTP status yang layak dikembalikan ke kasir. */
      status: number;
      /** Pesan yang AMAN dibaca kasir di depan customer. */
      reason: string;
      /**
       * Kode stabil untuk log server-side. Kasir tidak boleh melihat ini -
       * pesan yang berbeda untuk "order sudah discan" vs "kode salah" akan
       * memberi tahu customer kalau ordernya memang ada.
       */
      code:
        | "merchant_disabled"
        | "order_not_found"
        | "wrong_merchant"
        | "already_scanned"
        | "expired"
        | "invalid_state";
    };

/**
 * Status yang masih boleh dipindai.
 *
 * `pending_merchant` satu-satunya. Status lain berarti order sudah diproses
 * oleh jalur lain atau sudah selesai - memindai ulang di situ tidak
 * menghasilkan apa pun dan hanya berisiko mengirim top up dua kali.
 */
const SCANNABLE_STATUS = "pending_merchant";

/**
 * Resolve input kasir menjadi Order ID.
 *
 * Kasir bisa mengetik kode pendek (`MR7K2-X9Q`) ATAU Order ID lengkap
 * (`NBH-20261008-44BA21FB45`). Keduanya adalah kode yang sah untuk order
 * yang sama, dan keduanya harus bekerja: yang pertama untuk input manual
 * yang cepat, yang kedua untuk QR yang gagal dibaca atau order lama yang
 * dibuat sebelum migrasi 039.
 *
 * Mendeteksi jenis input dilakukan dari POLA, bukan dari mencoba query dua
 * kali. Query `or=(code.eq.X,id.eq.X)` terdengar elegan, tapi PostgREST
 * membalas baris pertama yang cocok tanpa urutan yang dijamin - dan kita
 * butuh tahu kode mana yang benar-benar yang diketik.
 */
type OrderLookupRow = {
  id: string;
  merchant_id: string | null;
  status: string;
  final_price: number | string;
  expires_at: string | null;
  merchants: unknown;
};

/**
 * Nama toko dari relasi Foreign Key.
 *
 * PostgREST mengirim relasi satu-ke-satu sebagai objek, tapi bentuk
 * jawabannya tidak dijamin lintas versi — karena itu dua-duanya dinormalisasi
 * di sini, bukan di pemanggil.
 */
function relatedName(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return null;
  const picked = (first as Record<string, unknown>).name;
  return typeof picked === "string" ? picked : null;
}

async function resolveOrderId(
  rawInput: string,
  merchantId: string,
): Promise<{ order: MerchantScanOrder | null }> {
  const trimmed = rawInput.trim();

  // Kode pindai selalu diawali `MR` setelah normalisasi.
  const scanCode = normalizeScanCode(trimmed);
  if (scanCode) {
    const byCode = await supabaseSelect<OrderLookupRow>("orders", {
      select:
        "id,merchant_id,status,final_price,expires_at,merchants!left(name)",
      filters: { merchant_scan_code: `eq.${scanCode}` },
      limit: 1,
    });
    const row = byCode[0];
    if (!row) return { order: null };
    return { order: { ...row, merchant_name: relatedName(row.merchants) } };
  }

  // Bukan kode pindai - perlakukan sebagai Order ID.
  const order = await getOrderForMerchantScan(trimmed);
  return { order };
}

export async function confirmMerchantScan(
  rawCode: string,
  merchantId: string,
): Promise<ScanResult> {
  const { order } = await resolveOrderId(rawCode, merchantId);

  if (!order) {
    return {
      ok: false,
      status: 404,
      reason: "Kode tidak ditemukan. Minta pelanggan memeriksa layar pesanannya.",
      code: "order_not_found",
    };
  }

  const orderId = order.id;

  // Dicentang sebelum status apa pun dibaca. Merchant harus tidak bisa
  // memindai order milik toko lain hanya karena tahu ID-nya.
  if (order.merchant_id !== merchantId) {
    return {
      ok: false,
      status: 403,
      reason: "Kode ini bukan untuk toko Anda.",
      code: "wrong_merchant",
    };
  }

  if (order.status !== SCANNABLE_STATUS) {
    /*
     * "Sudah dipindai" adalah jawaban yang benar DAN kode `already_scanned`.
     * Kasir yang memindai dua kali (kode tertinggal di konter, atau tidak
     * yakin kliknya masuk) harus melihat jawaban yang sama seperti scan
     * pertama - yaitu berhasil. Menolaknya akan membuat kasir memilih
     * memindai ulang terus-menerus, padahal ordernya sudah jalan.
     *
     * Yang tidak boleh terjadi di sini: mengirim ulang ke supplier. Itu
     * urusan `fulfillPaidOrder`, yang sudah idempoten lewat `requestRef`.
     */
    return {
      ok: false,
      status: 409,
      reason:
        order.status === "paid" || order.status === "processing" || order.status === "success"
          ? "Pesanan ini sudah dipindai dan sedang diproses."
          : "Pesanan ini tidak dalam status yang bisa dipindai.",
      code: order.status === "pending_payment" ? "invalid_state" : "already_scanned",
    };
  }

  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    /*
     * Order lewat masa berlaku TIDAK otomatis dibatalkan di sini. Sweeper
     * yang jadi miliknya (`sweepExpiredMerchantOrders`), dengan grace period
     * supaya kasir yang memindai di detik terakhir tidak losesomereservation.
     *
     * Menolak di sini penting: kalau tetap diproses, customer sudah datang
     * ke konter dan sudah bayar, tapi order-nya hangus karena cron belum
     * sempat jalan.
     */
    return {
      ok: false,
      status: 410,
      reason: "Kode ini sudah kedaluwarsa. Minta pelanggan membuat pesanan baru.",
      code: "expired",
    };
  }

  /*
   * Compare-and-swap pada status. Ini yang membuat kode single-use.
   *
   * Dua kasir di toko yang sama bisa menekan tombol bersamaan untuk kode
   * yang sama. Tanpa CAS, keduanya membaca `pending_merchant`, keduanya
   * menulis `paid`, dan fulfillment bisa berjalan dua kali.
   *
   * Filter `status = pending_merchant` membuat hanya satu yang menang.
   * "sudah dipindai" - bukan error, karena order-nya memang sedang jalan.
   */
  const claimed = await supabaseUpdate<{ id: string }>(
    "orders",
    {
      status: "paid",
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      filters: {
        id: `eq.${orderId}`,
        status: `eq.${SCANNABLE_STATUS}`,
      },
    },
  );

  if (claimed.length === 0) {
    return {
      ok: false,
      status: 409,
      reason: "Pesanan ini sudah dipindai dan sedang diproses.",
      code: "already_scanned",
    };
  }

  return {
    ok: true,
    orderId,
    merchantName: order.merchant_name ?? "",
    amount: Number(order.final_price) || 0,
  };
}
