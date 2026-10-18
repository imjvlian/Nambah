import { readCachedAccountCheck } from "@/lib/account-check-cache";
import { decideMlbbPurchaseLimit } from "@/lib/account-verification-policy";
import {
  getGameAccountSchema,
  validateGameAccountTarget,
} from "@/lib/game-account";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

const MLBB_GAME_ID = "mobile-legends";

/**
 * Lookup eligibility item limited (0.9a) — CACHE-ONLY, aturan RPM.
 *
 * Endpoint ini TIDAK PERNAH memanggil Melostore. Satu-satunya sumber data
 * adalah kolom purchase_limit di account_check_cache — diisi maksimal satu
 * kali per 24 jam per akun oleh cek akun UI atau gate checkout. Kalau
 * datanya belum ada, jawabannya "unknown" — bukan cek baru. Popup & banner
 * membaca gratis; jatah 40 cek gratis/hari Melostore tetap utuh.
 *
 * Server-lah yang mencocokkan productId -> supplier_sku (supplier_products);
 * supplier_sku tidak pernah terekspos ke browser. Keputusan limit memakai
 * decideMlbbPurchaseLimit — policy yang sama persis dengan gate checkout,
 * jadi popup tidak pernah menjanjikan sesuatu yang gate tolak (atau
 * sebaliknya).
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

  // Satu-satunya game dengan data purchase-limit saat ini. Game lain
  // dijawab langsung tanpa menyentuh DB — bukan limited.
  if (gameId !== MLBB_GAME_ID) {
    return Response.json({ limited: false });
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

  /*
   * Produk ini "limited" hanya kalau mapping Melostore-nya memang paket
   * WDP / Double Diamonds. Pencocokan SKU ke supplier adanya di server.
   */
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
  if (!supplierSku || !/^(weekly-pass|double-diamonds)/.test(supplierSku)) {
    return Response.json({ limited: false });
  }

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
