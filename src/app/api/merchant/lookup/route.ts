import { lookupMerchantScanCode } from "@/lib/merchant-lookup";
import { authenticateMerchant } from "@/lib/merchant-route-auth";
import { isMerchantRetailEnabled } from "@/lib/merchant-retail";

/**
 * POST /api/merchant/lookup — pratinjau order sebelum dijalankan.
 *
 * TIDAK mengubah apa pun. Kasir memakai ini untuk memeriksa kode yang salah
 * ketik (atau kode orang lain) sebelum menekan tombol yang mengirim top up.
 *
 * Endpoint ini ada karena kesalahan paling mahal di meja kasir bukan "gagal
 * memproses" - tapi berhasil memproses order yang salah. Sekali top up terkirim,
 * tidak ada yang bisa membatalkannya.
 *
 * Autentikasi memakai helper yang sama dengan `/api/merchant/confirm`.
 * Kalau keduanya punya logikanya sendiri, akan datang waktunya keduanya
 * berbeda - dan route yang bisa melihat pratinjau tanpa login adalah lubang.
 */
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

  const auth = await authenticateMerchant(request, body, "merchant_lookup");
  if ("response" in auth) return auth.response;

  const orderCode =
    typeof body.orderCode === "string" ? body.orderCode.trim() : "";

  if (!orderCode) {
    return Response.json(
      { error: "Kode pesanan wajib diisi." },
      { status: 400 },
    );
  }

  const result = await lookupMerchantScanCode(orderCode, auth.merchant.id);

  if (!result.found) {
    return Response.json({ error: result.reason }, { status: result.status });
  }

  return Response.json({
    ok: true,
    ...result,
    /*
     * `found: true` BUKAN berarti order ini bisa dijalankan.
     *
     * `blockedReason` yang menentukan itu, dan sengaja dikirim terpisah.
     * Mengembalikan `ok: true` untuk order yang sudah dipindai membuat
     * kasir menekan tombol konfirmasi, lalu mendapat penolakan yang tidak
     * dia ожидавал - dan dia akan mengira kodenya yang salah.
     */
    canRun: result.blockedReason === null,
  });
}