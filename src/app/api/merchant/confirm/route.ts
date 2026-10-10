import { resolveNambahAuth } from "@/lib/nambah-auth";
import {
  confirmMerchantScan,
} from "@/lib/merchant-confirm";
import { resolveMerchantForCode } from "@/lib/merchant-auth";
import { fulfillPaidOrder } from "@/lib/fulfillment";
import {
  isMerchantRetailEnabled,
  syncMerchantBalance,
} from "@/lib/merchant-retail";

/**
 * POST /api/merchant/confirm — kasir memindai kode pesanan.
 *
 * Autentikasi merchant memakai `code` + `pin`, bukan sesi Supabase. Alasannya
 * operasional: kasir berada di konter dengan satu perangkat, sering berubah,
 * dan harus bisa masuk tanpa email. `merchants.user_id` tetap tersedia untuk
 * merchant yang memang punya akun, tapi jalur kodenya cukup untuk pekerjaan
 * harian dan tidak menambah langkah login yang tidak perlu.
 *
 * PIN tidak disimpan di database. Yang disimpan adalah hash-nya, pakai
 * scrypt yang sama dengan password pengguna, supaya kebocoran satu merchant
 * tidak langsung memberi akses ke yang lain.
 */
export async function POST(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Program toko ritel belum aktif." },
      { status: 403 },
    );
  }

  let body: { code?: unknown; pin?: unknown; orderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";

  if (!code || !pin || !orderId) {
    return Response.json(
      { error: "Kode toko, PIN, dan kode pesanan wajib diisi." },
      { status: 400 },
    );
  }

  const merchant = await resolveMerchantForCode(code, pin);

  if (!merchant) {
    /*
     * Satu pesan untuk "kode tidak ada" dan "PIN salah". Membedakan keduanya
     * akan membantu penyerang: dia bisa menguji daftar kode toko
     * tanpa PIN yang benar.
     */
    return Response.json(
      { error: "Kode toko atau PIN salah." },
      { status: 401 },
    );
  }

  if (merchant.status !== "active") {
    return Response.json(
      { error: "Toko sedang tidak menerima pesanan." },
      { status: 403 },
    );
  }

  const scan = await confirmMerchantScan(orderId, merchant.id);

  if (!scan.ok) {
    console.warn(
      `Merchant scan gagal (${scan.code}) — merchant ${merchant.id}, order ${orderId}`,
    );
    return Response.json({ error: scan.reason }, { status: scan.status });
  }

  /*
   * Fulfillment sengaja TIDAK awaited sebelum respons.
   *
   * Ini bukan sekadar optimasi. `fulfillPaidOrder` memanggil API supplier,
   * yang bisa memakan puluhan detik. Menahannya membuat kasir mengira
   * pemindaian gagal lalu memindai ulang - padahal order sudah `paid` dan
   * top up sedang berjalan, sehingga goodbye terjadi dua kali.
   *
   * Order sudah aman pada titik ini: status `paid` + `requestRef` yang
   * deterministik membuat proses yang berjalan terlambat tetap idempoten.
   * Kalau prosesnya benar-benar mati di tengah jalan, reconciler akan
   * mengambil alih lewat `supplier_transactions`.
   */
  void fulfillPaidOrder(orderId)
    .then(() => syncMerchantBalance(merchant.id))
    .catch((error) => {
      // Kegagalan di sini tercatat di supplier_transactions dan akan
      // disapu reconciler. Log saja - kasir tidak bisa memperbaiki ini.
      console.error(`Fulfillment merchant order ${orderId} gagal`, error);
    });

  return Response.json({
    ok: true,
    orderId: scan.orderId,
    merchantName: scan.merchantName,
    amount: scan.amount,
    message: "Pesanan diterima, sedang diproses.",
  });
}