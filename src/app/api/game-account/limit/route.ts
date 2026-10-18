import { readCachedAccountCheck } from "@/lib/account-check-cache";
import { decideMlbbLimitForClass } from "@/lib/account-verification-policy";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "@/lib/game-account";
import { classifyLimitedItem } from "@/lib/purchase-limit-ux";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

/**
 * Lookup eligibility item limited — CACHE-ONLY + RIWAYAT SENDIRI.
 *
 * Endpoint ini TIDAK PERNAH memanggil Melostore. Dua sumber data:
 * 1. Cache purchase-limit (kolom purchase_limit, diisi cek akun UI / gate
 *    checkout maksimal sekali per 24 jam per akun) — untuk kelas
 *    terverifikasi-supplier (WDP, FTU, SKU event DD).
 * 2. Riwayat order Nambah (tabel orders) — untuk kelas tanpa data
 *    supplier: sekali-per-akun (Twilight Pass, FTU non-MLBB) dan
 *    periodik (Weekly/Monthly Elite, pack mingguan/bulanan game lain).
 *
 * Klasifikasi lewat classifyLimitedItem — alias SKU dari data mapping
 * nyata + fallback label. Keputusan supplier memakai decideMlbbLimitForClass
 * (policy yang sama persis dengan gate checkout), jadi popup tidak pernah
 * menjanjikan sesuatu yang gate tolak.
 *
 * Status respons:
 * - eligible           : masih bisa dibeli. Popup tidak muncul.
 * - limit_blocked      : terverifikasi supplier — order pasti ditolak.
 * - previously-purchased: riwayat Nambah menunjukkan item sekali-selamanya
 *                        ini sudah dibeli — pasti gagal.
 * - recently-purchased : riwayat dalam periode (7/31 hari) — mungkin
 *                        sudah reset, keputusan di tangan pembeli.
 * - consent-required   : sekali-per-akun tanpa data — pembeli memastikan.
 * - unknown            : data akun belum ada di cache; cek User ID dulu.
 * - limited: false     : bukan item limited (termasuk periodik tanpa
 *                        riwayat — pembelian berulang adalah kasus normal).
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

  const cls = classifyLimitedItem({
    gameId,
    supplierSku: supplierSku || null,
    label: product.label,
  });

  if (!cls) {
    return Response.json({ limited: false });
  }

  /*
   * (1) Kelas terverifikasi-supplier: data purchase-limit dari cache —
   * gratis, tanpa memanggil Melostore (jatah 40 cek gratis/hari tetap
   * utuh; datanya diisi cek akun UI / gate checkout).
   */
  if (
    cls.kind === "supplier-weekly-pass" ||
    cls.kind === "supplier-double-diamonds"
  ) {
    const cached = await readCachedAccountCheck(
      gameId,
      account.userId,
      account.serverId,
    );
    const purchaseLimit = cached?.purchaseLimit ?? null;
    if (!purchaseLimit) {
      return Response.json({ limited: true, status: "unknown" });
    }

    const decision = decideMlbbLimitForClass({
      cls,
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
   * (2) Sekali-per-akun. Limit in-game berlaku untuk AKUN, toko mana
   * pun — riwayat Nambah adalah bukti yang sah:
   * - scope any-purchase (FTU): top up APA PUN di game ini menghabiskan
   *   hak bonus, jadi riwayat diperiksa lintas produk (satu game).
   * - scope this-product (Twilight Pass): hanya pembelian paket ini yang
   *   menghabiskannya.
   */
  if (cls.kind === "once-per-account") {
    const last = await cariPembelianTerakhir({
      gameId,
      productId: cls.scope === "this-product" ? productId : null,
      userId: account.userId,
      serverId: account.serverId,
    });
    if (last) {
      return Response.json({
        limited: true,
        status: "previously-purchased",
        scope: cls.scope,
        lastPurchasedAt: last,
      });
    }
    return Response.json({ limited: true, status: "consent-required" });
  }

  /*
   * (3) Periodik (weekly/monthly pack). Riwayat dalam jendela 7/31 hari
   * → peringatan; hari reset game tidak bisa dipastikan, jadi keputusan
   * akhir tetap di tangan pembeli (popup kuning). Tanpa riwayat → diam:
   * pembelian berulang tiap periode adalah kasus NORMAL, bukan risiko.
   */
  const last = await cariPembelianTerakhir({
    gameId,
    productId,
    userId: account.userId,
    serverId: account.serverId,
  });
  const dalamJendela =
    last !== null &&
    Date.parse(last) >= Date.now() - cls.windowDays * 86_400_000;

  if (dalamJendela && last) {
    return Response.json({
      limited: true,
      status: "recently-purchased",
      lastPurchasedAt: last,
      windowDays: cls.windowDays,
    });
  }

  return Response.json({ limited: false });
}

/**
 * Pembelian sukses terakhir untuk akun+produk (atau akun+game), atau null.
 *
 * Hanya status `success` — pembelian yang gagal di supplier (dan
 * kemudian di-refund) tidak pernah menghabiskan limit in-game, jadi
 * tidak boleh ikut memblokir.
 */
async function cariPembelianTerakhir(input: {
  gameId: string;
  /** Null = semua produk game ini (scope any-purchase). */
  productId: string | null;
  userId: string;
  serverId: string | null | undefined;
}): Promise<string | null> {
  const filters: Record<string, string> = {
    game_id: `eq.${input.gameId}`,
    target_user_id: `eq.${input.userId}`,
    status: "eq.success",
  };
  if (input.productId) {
    filters.product_id = `eq.${input.productId}`;
  }
  if (input.serverId) {
    filters.target_server_id = `eq.${input.serverId}`;
  }

  const rows = await supabaseSelect<{
    paid_at: string | null;
    created_at: string;
  }>("orders", {
    select: "paid_at,created_at",
    filters,
    order: "created_at.desc",
    limit: 1,
  });

  const row = rows[0];
  return row ? row.paid_at ?? row.created_at : null;
}
