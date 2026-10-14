import { lookupMerchantScanCode } from "@/lib/merchant-lookup";
import { authenticateMerchant } from "@/lib/merchant-route-auth";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";
import { readMerchantSession } from "@/lib/merchant-session";

/**
 * POST /api/merchant/lookup - pratinjau order sebelum dijalankan.
 *
 * TIDAK mengubah apa pun. Kasir memakai ini untuk memeriksa kode yang salah
 * ketik (atau kode orang lain) sebelum menekan tombol yang mengirim top up.
 *
 * Endpoint ini ada karena kesalahan paling mahal di meja kasir bukan "gagal
 * memproses" - tapi berhasil memproses order yang salah. Sekali top up terkirim,
 * tidak ada yang bisa membatalkannya.
 *
 * Autentikasi memakai helper yang sama dengan `/api/merchant/confirm`: sesi
 * portal dulu, kode + PIN sebagai cadangan. Kalau keduanya punya logikanya
 * sendiri, akan datang waktunya keduanya berbeda - dan route yang bisa melihat
 * pratinjau tanpa login adalah lubang.
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

  const orderCode = typeof body.orderCode === "string" ? body.orderCode.trim() : "";
  if (!orderCode) {
    return Response.json(
      { error: "Kode pesanan wajib diisi." },
      { status: 400 },
    );
  }

  /*
   * Autentikasi berlapis: sesi portal dulu, kode + PIN sebagai cadangan.
   *
   * Kasir yang sudah login di `/merchant` tidak mengirim PIN di client, jadi
   * tanpa sesi endpoint ini menolak preview dengan 400 (\"Kode toko dan PIN
   * wajib diisi\") padahal sesi masih hidup.
   */
  const sessionMerchantId = readMerchantSession(request);
  const sessionMerchant = sessionMerchantId
    ? await getMerchantById(sessionMerchantId)
    : null;

  let currentMerchantName: string | null = sessionMerchant?.name ?? null;

  let merchant: { id: string; status: string } | null = sessionMerchant
    ? { id: sessionMerchant.id, status: sessionMerchant.status }
    : null;

  if (!merchant) {
    const auth = await authenticateMerchant(request, body, "merchant_lookup");
    if ("response" in auth) return auth.response;
    merchant = { id: auth.merchant.id, status: auth.merchant.status };
    currentMerchantName = auth.merchant.name;
  }

  if (merchant.status !== "active") {
    return Response.json(
      {
        error:
          merchant.status === "pending"
            ? "Toko ini belum disetujui admin."
            : merchant.status === "frozen"
              ? "Toko sedang dibekukan karena ada piutang yang belum lunas."
              : "Toko sedang tidak menerima pesanan.",
      },
      { status: 403 },
    );
  }

  const result = await lookupMerchantScanCode(orderCode, merchant.id);

  if (!result.found) {
    if (result.code === "wrong_merchant") {
      const ownerName = result.merchantName ?? "toko lain";
      const mine = currentMerchantName ?? "toko Anda";
      return Response.json(
        {
          error: `Kode ini milik toko ${ownerName}, bukan ${mine}. Pastikan Anda login di toko yang sama dengan pemesan.`,
        },
        { status: result.status },
      );
    }
    return Response.json({ error: result.reason }, { status: result.status });
  }

  return Response.json({
    ok: true,
    ...result,
    /*
     * `found: true` BUKAN berarti order ini bisa dijalankan.
     *
     * `blockedReason` yang menentukan itu, dan sengaja dikirim terpisah.
     */
    canRun: result.blockedReason === null,
  });
}