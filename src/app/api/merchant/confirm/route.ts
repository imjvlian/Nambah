import { confirmMerchantScan } from "@/lib/merchant-confirm";
import { authenticateMerchant } from "@/lib/merchant-route-auth";
import {
  isMerchantRetailEnabled,
  syncMerchantBalance,
} from "@/lib/merchant-retail";
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

  const auth = await authenticateMerchant(request, body, "merchant_confirm");
  if ("response" in auth) return auth.response;
  const merchant = auth.merchant;

  // Nama field-nya `orderCode`, bukan `code`, supaya tidak tertukar dengan
  // kode toko di payload yang sama.

  const orderCode =
    typeof body.orderCode === "string" ? body.orderCode.trim() : "";

  if (!orderCode) {
    return Response.json(
      { error: "Kode pesanan wajib diisi." },
      { status: 400 },
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