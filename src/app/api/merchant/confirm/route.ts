import { confirmMerchantScan } from "@/lib/merchant-confirm";
import { authenticateMerchant } from "@/lib/merchant-route-auth";
import {
  getMerchantById,
  isMerchantRetailEnabled,
  syncMerchantBalance,
} from "@/lib/merchant-retail";
import { readMerchantSession } from "@/lib/merchant-session";
import { fulfillPaidOrder } from "@/lib/fulfillment";

export async function POST(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Program toko ritel belum aktif." },
      { status: 403 },
    );
  }

  let body: { code?: unknown; pin?: unknown; orderCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const orderCode = typeof body.orderCode === "string" ? body.orderCode.trim() : "";
  if (!orderCode) {
    return Response.json({ error: "Kode pesanan wajib diisi." }, { status: 400 });
  }

  /*
   * Autentikasi BERGANDA: sesi portal dulu, kode + PIN sebagai cadangan.
   *
   * Dulu route ini hanya menerima kode + PIN di setiap permintaan. Artinya
   * kasir yang sudah login di `/merchant` tetap harus mengetik ulang keduanya
   * begitu berpindah ke layar kasir - di aplikasi, perangkat, dan sesi yang
   * sama. Itu bukan keamanan, hanya gesekan.
   *
   * Yang tetap dijaga: tanpa sesi, kode + PIN wajib; rate limit per IP tetap
   * berlaku di kedua jalur; dan status toko tetap harus `active` sebelum
   * boleh mengirim top up ke supplier.
   *
   * RESIKO YANG TETAP ADA: sesi berumur 12 jam, jadi perangkat kasir yang
   * ditinggal terbuka masih bisa dipakai orang berikutnya. Kalau nanti ini
   * jadi masalah di operasional, jalankan `/merchant/kasir` sebagai mode
   * "mesin khusus" yang selalu meminta PIN - bukan dengan memaksa kode +
   * PIN di setiap pindai seperti sebelumnya.
   */
  const sessionMerchantId = readMerchantSession(request);
  const sessionMerchant = sessionMerchantId
    ? await getMerchantById(sessionMerchantId)
    : null;

  /*
   * Dua cabang ini menghasilkan bentuk data yang berbeda - `MerchantRow`
   * dari database dan `MerchantAuthRow` dari verifikasi PIN. Yang dipakai
   * di bawah hanya `id` dan `status`, jadi kedua bentuknya diseragamkan
   * di sini. Menyatukannya lebih awal membuat seluruh sisa fungsi bebas
   * dari percabangan tipe.
   */
  let merchant: { id: string; status: string } | null = sessionMerchant
    ? { id: sessionMerchant.id, status: sessionMerchant.status }
    : null;

  if (!merchant) {
    const auth = await authenticateMerchant(request, body, "merchant_confirm");
    if ("response" in auth) return auth.response;
    merchant = { id: auth.merchant.id, status: auth.merchant.status };
  }

  if (merchant.status !== "active") {
    return Response.json(
      { error: "Toko sedang tidak menerima pesanan." },
      { status: 403 },
    );
  }

  const scan = await confirmMerchantScan(orderCode, merchant.id);

  if (!scan.ok) {
    console.warn(
      `Merchant scan gagal (${scan.code}) — merchant ${merchant.id}, kode ${orderCode}`,
    );
    return Response.json({ error: scan.reason }, { status: scan.status });
  }

  const orderId = scan.orderId;

  /*
   * Fulfillment sengaja TIDAK awaited sebelum respons.
   *
   * Ini bukan sekadar optimasi. `fulfillPaidOrder` memanggil API supplier,
   * yang bisa memakan puluhan detik. Menahannya membuat kasir mengira
   * pemindaian gagal lalu memindai ulang - padahal order sudah `paid` dan
top up sedang berjalan, sehingga top up terjadi dua kali.
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