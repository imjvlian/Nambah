import { readCachedAccountCheck } from "@/lib/account-check-cache";
import { decideMlbbPurchaseLimit } from "@/lib/account-verification-policy";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "@/lib/game-account";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";
import { isOncePerAccountLabel } from "@/lib/purchase-limit-ux";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

const MLBB_GAME_ID = "mobile-legends";

/**
 * Lookup eligibility item limited — CACHE-ONLY, aturan RPM.
 *
 * Endpoint ini TIDAK PERNAH memanggil Melostore. Klasifikasinya:
 *
 * - eligible         — data purchase-limit (cache) menyatakan akun masih
 *                     bisa membeli. Popup tidak muncul.
 * - limit_blocked    — data supplier menyatakan limit tercapai (WDP /
 *                     Double Diamonds MLBB). Order PASTI ditolak gate,
 *                     jadi popup tidak menawarkan tombol lanjutkan
 *                     (keputusan owner: lanjutkan hanya untuk yang masih
 *                     mungkin dibeli).
 * - unknown          — item terverifikasi-supplier tapi data akun belum
 *                     pernah diambil; UI mengarahkan cek User ID dulu.
 * - consent-required — item sekali-per-akun TANPA sumber verifikasi
 *                     supplier (First Top Up / First Recharge; untuk
 *                     MLBB, item Double Diamonds yang belum terpetakan
 *                     ke Melostore). Bisa jadi bisa dibeli — pembeli
 *                     yang mengonfirmasi lewat popup consent.
 * - limited: false  — bukan item limited.
 *
 * Server-lah yang mengklasifikasi lewat supplier_sku (item MLBB terpeta)
 * dan label produk (keluarga sekali-per-akun); keduanya tidak pernah
 * terekspos ke browser. Keputusan limit memakai decideMlbbPurchaseLimit —
 * policy yang sama persis dengan gate checkout, jadi popup tidak pernah
 * menjanjikan sesuatu yang gate tolak (atau sebaliknya).
 */
export async function GET(request: Request) {
  const durableLimit = await rateLimitResponse(request, {
    scope: "game-account-limit",
    limit: 60,
    windowSeconds: 10 * 60,
  });
  if (durableLimit) return durableLimit;

  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Konfigurasi database ${BRAND.shortName} belum lengkap.` },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const gameId = url.searchParams.get("gameId")?.trim() ?? "";
  const productId = url.searchParams.get("productId")?.trim() ?? "";
  const rawUserId = url.searchParams.get("userId")?.trim() ?? "";
  const rawServerId = url.searchParams.get("serverId")?.trim() ?? "";

  if (!gameId || !productId || !rawUserId) {
    return Response.json(
      { error: "Parameter tidak lengkap." },
      { status: 400 },
    );
  }

  const [game] = await supabaseSelect<{
    id: string;
    name: string;
    short_name: string;
    requires_server: boolean;
    active: boolean;
  }>("games", {
    select: "id,name,short_name,requires_server,active",
    filters: { id: `eq.${gameId}`, active: "eq.true" },
    limit: 1,
  });
  if (!game) {
    return Response.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const descriptor = {
    id: game.id,
    name: game.name,
    shortName: game.short_name,
    requiresServer: game.requires_server,
  };
  const schema = getGameAccountSchema(descriptor);
  if (!schema.checker) {
    return Response.json({ limited: false });
  }

  const account = validateGameAccountTarget(descriptor, rawUserId, rawServerId);
  if (!account.ok) {
    return Response.json({ error: account.error }, { status: 400 });
  }

  const [product] = await supabaseSelect<{ label: string }>("products", {
    select: "label",
    // id + game_id sekaligus memastikan produk ini memang milik game itu.
    filters: {
      id: `eq.${productId}`,
      game_id: `eq.${gameId}`,
      active: "eq.true",
    },
    limit: 1,
  });
  if (!product) {
    return Response.json({ limited: false });
  }

  const [mapping] = await supabaseSelect<{ supplier_sku: string | null }>(
    "supplier_products",
    {
      select: "supplier_sku",
      filters: {
        product_id: `eq.${productId}`,
        supplier_id: "eq.melostore",
        active: "eq.true",
      },
      limit: 1,
    },
  );
  const supplierSku = mapping?.supplier_sku?.trim() ?? "";

  /*
   * (1) Item terverifikasi-supplier: WDP / Double Diamonds MLBB yang
   * terpetakan ke Melostore. Data purchase-limit dibaca dari cache —
   * gratis, tanpa memanggil Melostore (jatah 40 cek gratis/hari
   * tetap utuh).
   */
  const supplierVerified =
    gameId === MLBB_GAME_ID &&
    Boolean(supplierSku) &&
    /^(weekly-pass|double-diamonds)/.test(supplierSku);

  if (supplierVerified) {
    const cached = await readCachedAccountCheck(
      gameId,
      account.userId,
      account.serverId,
    );
    const purchaseLimit = cached?.purchaseLimit ?? null;
    if (!purchaseLimit) {
      return Response.json({ limited: true, status: "unknown" });
    }

    const decision = decideMlbbPurchaseLimit({
      supplierSku,
      weeklyPass: purchaseLimit.weeklyPass,
      doubleDiamonds: purchaseLimit.doubleDiamonds,
      doubleDiamondsEligible: purchaseLimit.doubleDiamondsEligible,
    });

    if (!decision.ok) {
      return Response.json({
        limited: true,
        status: "limit_blocked",
        reason: decision.reason,
      });
    }

    return Response.json({ limited: true, status: "eligible" });
  }

  /*
   * (2) Item sekali-per-akun tanpa sumber verifikasi supplier.
   *
   * Melostore tidak menyediakan purchase-limit untuk game selain MLBB,
   * dan bonus First Top Up MLBB hanya terverifikasi kalau produknya
   * terpetakan ke SKU double-diamonds-* (di atas). Untuk sisanya —
   * First Recharge Magic Chess, FTU yang baru terpetakan Digiflazz,
   * DD MLBB yang belum terpetakan — tidak ada pihak yang bisa
   * memastikan kecuali pembeli sendiri, jadi jawabannya consent.
   * Order tetap dijaga: klaim ganda ditolak supplier -> gagal rapi ->
   * refund.
   */
  const sekaliPerAkun =
    isOncePerAccountLabel(product.label) ||
    (gameId === MLBB_GAME_ID && /double\s*diamond/i.test(product.label));

  if (sekaliPerAkun) {
    return Response.json({ limited: true, status: "consent-required" });
  }

  return Response.json({ limited: false });
}
