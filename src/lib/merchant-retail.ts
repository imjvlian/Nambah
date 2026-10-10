import "server-only";

import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";
import {
  MAX_RECEIVABLE_IDR,
  evaluateMerchantCredit,
  type MerchantEligibility,
} from "@/lib/merchant-retail-rules";
import type { MerchantStatus } from "@/lib/merchant-retail-types";

// Di-re-export supaya pemanggil cukup mengimpor dari satu modul.
export { MAX_RECEIVABLE_IDR };
export type { MerchantStatus, MerchantEligibility };

/**
 * Program merchant ritel.
 *
 * MODEL BISNIS — baca ini sebelum mengubah apa pun:
 *
 *   User ──(harga katalog + biaya layanan)──> Merchant
 *   Merchant ──(scan kode)──> Lacte fulfill ke supplier
 *   Merchant ──(transfer, dicatat admin)──> Lacte
 *
 * Berbeda dari payment method biasa: Lacte TIDAK menerima pembayaran dari
 * user. User membayar ke merchant. Yang jadi piutang Lacte adalah transfer
 * merchant, dan itu muncul SESUDAH fulfillment — bukan sebelumnya.
 *
 * Akibatnya:
 *
 * - `nambahProfit` order merchant selalu 0 (fee 100% milik merchant), jadi
 *   guard `minimumNambahProfit` harus di-bypass khusus jalur ini.
 * - Lacte menanggung `supplier_cost` sejak fulfill sampai merchant pays.
 *   Saldo Digiflazz terpakai lebih dulu. Ini risiko kas, bukan pembukuan.
 * - Merchant boleh scan tanpa transfer (keputusan bisnis). Karena itu
 *   `MAX_RECEIVABLE_IDR` ada — tanpa batas, satu merchant bisa membuat
 *   piutang tak terbatas dan Lacte tidak punya cara berhenti.
 */

export type MerchantRow = {
  id: string;
  user_id: string | null;
  name: string;
  code: string;
  /** Alamat toko. Wajib diisi saat pendaftaran mandiri (migrasi 040). */
  address: string | null;
  /** Nomor HP/WA toko, opsional. */
  contact: string | null;
  service_fee_flat_idr: number | string;
  payment_term_days: number;
  status: MerchantStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type MerchantBalanceRow = {
  merchant_id: string;
  balance: number | string;
  checked_at: string;
};

/**
 * Apakah jalur merchant diizinkan sama sekali.
 *
 * Env flag, bukan DB flag, karena jalur ini mengubah
 * `supplier_cost` jadi piutang sebelum uang masuk. Kalau ternyata salah
 * konfigurasi, mematikan lewat env adalah cara tercepat tanpa deploy kode.
 *
 * `payment_methods.active` dicek terpisah di lapisan pemanggil — dua
 * lapis, supaya mematikan lewat env saja sudah cukup.
 */
export function isMerchantRetailEnabled() {
  const raw = process.env.MERCHANT_RETAIL_ENABLED?.trim().toLowerCase() ?? "";
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/**
 * Order masih menunggu merchant scan.
 *
 * Jendela ini jauh lebih panjang dari order Midtrans/DOKU. Alasan: pada
 * jalur merchant, yang menunggu bukan transfer online melainkan orang
 * datang ke konter dengan uang tunai. 30 menit tidak realistis — kode
 * akan kedaluwarsa sebelum merchant sempat ke sana.
 *
 * Dipisah dari `ORDER_EXPIRY_WINDOW_MS` karena keduanya punya alasan
 * berbeda. Menggabungkan keduanya akan membuat salah satunya salah.
 */
export const MERCHANT_ORDER_EXPIRY_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function getActiveMerchants(): Promise<MerchantRow[]> {
  const rows = await supabaseSelect<MerchantRow>("merchants", {
    select: "*",
    filters: { status: "eq.active" },
    order: "name.asc",
  });
  return rows;
}

export async function getMerchantById(id: string) {
  const [merchant] = await supabaseSelect<MerchantRow>("merchants", {
    select: "*",
    filters: { id: `eq.${id}` },
    limit: 1,
  });
  return merchant ?? null;
}

export async function getMerchantByCode(code: string) {
  const [merchant] = await supabaseSelect<MerchantRow>("merchants", {
    select: "*",
    filters: { code: `eq.${code}` },
    limit: 1,
  });
  return merchant ?? null;
}

/**
 * Piutang yang sedang berjalan untuk satu merchant.
 *
 * Dijumlahkan dari order, bukan dibaca dari tabel balance, supaya angka
 * yang dikembalikan selalu benar walau `merchant_balances` belum pernah
 * di-refresh. Tabel itu hanya cache untuk tampilan.
 */
export async function getOutstandingReceivable(merchantId: string) {
  const rows = await supabaseSelect<{
    final_price: number | string;
  }>("orders", {
    select: "final_price",
    filters: {
      merchant_id: `eq.${merchantId}`,
      // Filter `status = awaiting_receivable` TIDAK dipakai di sini, dan itu
      // disengaja: order merchant yang normal tetap berstatus `success`
      // setelah top up, dan piutangnya dicatat di kolom `receivable_*`.
      // Set status akan membuat order kehilangan status terminal-nya, dan
      // itu ikut merusak points, komisi, promo, serta receipt.
      //
      // `receivable_paid_at is null` adalah definisi yang benar: piutang
      // adalah apa yang belum dibayar merchant, bukan tahap lifecycle order.
      status: "eq.success",
      receivable_paid_at: "is.null",
    },
  });

  // Piutang Lacte adalah harga produk saja (`final_price`).
  //
  // `service_fee_amount` SENGAJA tidak ikut dihitung. Biaya layanan itu
  // dibayar user langsung ke merchant dan tidak pernah melewati Lacte —
  // menghitungnya di sini akan menagih utang yang bukan milik Lacte, dan
  // karena fee ikut terkirim ke supplier sebagai modal kerja, limit kredit
  // merchant jadi tergambar lebih besar dari risiko sebenarnya.
  return rows.reduce((total, row) => total + (Number(row.final_price) || 0), 0);
}

/**
 * Order yang SUDAH dijanjikan Lacte tapi merchant belum scan.
 *
 * Angka ini dipisah dari `getOutstandingReceivable` karena sifatnya berbeda:
 * piutang `awaiting_receivable` sudah menjadi kewajiban, sedangkan yang
 * ini masih bisa batal kalau customer tidak datang ke konter.
 *
 * Tapi dihitung terpisah, bukan diabaikan. Karena merchant BOLEH scan tanpa
 * transfer lebih dulu, setiap order di sini adalah piutang yang akan datang
 * dan ditanggung Lacte. Kalau lima order besar dibuat hampir bersamaan saat
 * customer berlomba-lomba checkout, semuanya lolos pemeriksaan kredit yang
 * sama - lalu merchant scan semuanya, dan piutang meledak melewati limit
 * yang tadinya dianggap sudah dijaga.
 */

export async function getPendingMerchantCommitment(merchantId: string) {
  const rows = await supabaseSelect<{
    final_price: number | string;
  }>("orders", {
    select: "final_price",
    filters: {
      merchant_id: `eq.${merchantId}`,
      status: "eq.pending_merchant",
    },
  });

  return rows.reduce((total, row) => total + (Number(row.final_price) || 0), 0);
}

/**
 * Apakah merchant boleh menerima order baru.
 *
 * Dipanggil SEBELUM order dibuat, di `POST /api/orders`. Menolak di sini
 * lebih baik daripada menahan order setelahnya - user sudah mengisi form
 * panjang kalau ditolak belakangan.
 *
 * PENTING: yang dibandingkan dengan limit adalah `committed`, bukan
 * `outstanding`. Order `pending_merchant` belum jadi utang, tapi merchant
 * boleh scan tanpa transfer, jadi begitu dia scan Lacte yang menanggung. Mengabi
 * lewatkan order yang belum discan membuat limit bisa ditembus berkali-kali
 * dalam satu menit, karena semua order itu dicek against angka yang sama.
 */
export async function checkMerchantCredit(
  merchantId: string,
): Promise<MerchantEligibility> {
  const merchant = await getMerchantById(merchantId);
  if (!merchant) {
    return evaluateMerchantCredit({
      found: false,
      status: null,
      outstanding: 0,
      pending: 0,
    });
  }

  const [outstanding, pending] = await Promise.all([
    getOutstandingReceivable(merchantId),
    getPendingMerchantCommitment(merchantId),
  ]);

  return evaluateMerchantCredit({
    found: true,
    status: merchant.status,
    outstanding,
    pending,
  });
}

/**
 * Sisa bayar yang belum terpakai - uang yang sudah diterima Lacte tapi
 * melebihi piutang yang sedang berjalan.
 *
 * Hitung dari dua sumber yang tidak boleh saling menimpa:
 *
 *   total diterima  = SUM(merchant_payments.amount)
 *   total dilunasi  = SUM(orders.final_price WHERE receivable_paid_at IS NOT NULL)
 *   kredit          = total diterima - total dilunasi
 *
 * Hanya order yang DITANDAI lunas yang ikut dihitung. Order yang baru terpubei
 * sebagian tidak mengurangi piutang, jadi uang yang menutupnya belum
 * "terpakai" dan masih harus mengurangi tagihan berikutnya.
 *
 * Fungsi ini ada karena `syncMerchantBalance` dihitung dari order saja.
 * Kalau kredit tidak ikut di sana, setiap refresh cache akan menghapusnya
 * dan kelebihan bayar merchant hilang tanpa pernah tercatat - persis bug yang
 * ditemukan saat pengujian: Rp91.800 lenyap setelah `recordMerchantPayment`
 * selesai.
 */
export async function getUnappliedPaymentCredit(merchantId: string) {
  const [payments, settled] = await Promise.all([
    supabaseSelect<{ amount: number | string }>("merchant_payments", {
      select: "amount",
      filters: { merchant_id: `eq.${merchantId}` },
    }),
    supabaseSelect<{ final_price: number | string }>("orders", {
      select: "final_price",
      filters: {
        merchant_id: `eq.${merchantId}`,
        receivable_paid_at: "not.is.null",
      },
    }),
  ]);

  const received = payments.reduce(
    (total, row) => total + (Number(row.amount) || 0),
    0,
  );
  const consumed = settled.reduce(
    (total, row) => total + (Number(row.final_price) || 0),
    0,
  );

  return received - consumed;
}

/**
 * Refresh cache `merchant_balances` supaya dashboard admin akurat.
 *
 * `balance` adalah PIUTANG BERSIH: piutang yang sedang berjalan dikurangi
 * sisa bayar. Angka ini boleh negatif - hanya itu alasan `merchant_balances`
 * tidak punya CHECK >= 0 di migrasi 036. Nilai negatif berarti Lacte punya
 * uang merchant yang belum terpakai, bukan berarti merchant berutang.
 *
 * Mengembalikan PIUTANG BERSIH, bukan piutang mentah, supaya pemanggil yang
 * butuh angka untuk ditampilkan memakai definisi yang sama dengan cache.
 */
export async function syncMerchantBalance(merchantId: string) {
  const [outstanding, pending, credit] = await Promise.all([
    getOutstandingReceivable(merchantId),
    getPendingMerchantCommitment(merchantId),
    getUnappliedPaymentCredit(merchantId),
  ]);

  const balance = outstanding - credit;
  const checkedAt = new Date().toISOString();

  await supabaseUpsert(
    "merchant_balances",
    {
      merchant_id: merchantId,
      balance,
      pending_commitment: pending,
      checked_at: checkedAt,
      updated_at: checkedAt,
    },
    { onConflict: "merchant_id" },
  );

  return balance;
}

/**
 * Order yang akan dipindai merchant, lengkap dengan nama toko.
 *
 * Query-nya sengaja BUKAT `merchant_id` di sini. `merchant-confirm.ts`
 * membandingkannya sendiri secara eksplisit supaya kode yang keliru
 * menghasilkan pesan yang bisa dibaca kasir ("bukan untuk toko Anda")
 * dan bukan diam-diam gagal karena filter yang tidak cocok.
 */
export type MerchantScanOrder = {
  id: string;
  merchant_id: string | null;
  merchant_name: string | null;
  status: string;
  final_price: number | string;
  expires_at: string | null;
};

export async function getOrderForMerchantScan(
  orderId: string,
): Promise<MerchantScanOrder | null> {
  const rows = await supabaseSelect<{
    orders: MerchantScanOrder;
    merchants: { name: string } | null;
  }>("orders", {
    select:
      "id,merchant_id,status,final_price,expires_at,merchants!left(name)",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  const row = rows[0];
  if (!row) return null;

  // `merchants` adalah relasi, jadi PostgREST mengirimnya sebagai array
  // atau objek tergantung jawaban join. Dua-duanya dinormalisasi di sini
  // supaya pemanggil tidak perlu tahu bentuknya.
  const raw = (row as unknown as { merchants: unknown }).merchants;
  const name =
    Array.isArray(raw) ?
      ((raw[0] as { name?: string } | undefined)?.name ?? null)
    : ((raw as { name?: string } | null)?.name ?? null);

  return { ...row.orders, merchant_name: name };
}

type ReceivableMerchantRow = {
  id: string;
  payment_term_days: number;
};

/**
 * Data merchant yang dibutuhkan saat membuka piutang satu order.
 *
 * Hanya `payment_term_days` yang diambil. Kelolaan merchant (nama, tarif
 * fee, status) TIDAK ikut karena akan membuat modul ini ikut berubah setiap
 * kali tabel `merchants` berkembang - dan pemanggil di `fulfillment.ts`
 * hanya butuh satu angka ini.
 */
export async function getMerchantForReceivable(orderId: string) {
  const rows = await supabaseSelect("orders", {
    select: "merchants!inner(id,payment_term_days)",
    filters: { id: `eq.${orderId}`, merchant_id: "not.is.null" },
    limit: 1,
  });

  const raw = (rows[0] as unknown as { merchants: unknown } | undefined)?.merchants;
  const merchant = (Array.isArray(raw) ? raw[0] : raw) as
    | ReceivableMerchantRow
    | undefined;

  if (!merchant?.id) return null;

  const days = Number(merchant.payment_term_days);
  return {
    id: merchant.id,
    payment_term_days: Number.isInteger(days) && days >= 1 ? days : 7,
  };
}