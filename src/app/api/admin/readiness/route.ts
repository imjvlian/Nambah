import { authorizeAdminRequest } from "@/lib/admin-api";
import { getFulfillmentMode } from "@/lib/fulfillment";
import { isFlowTestMode } from "@/lib/flow-test";
import { getGameAccountSchema } from "@/lib/game-account";
import { getMidtransEnvironment } from "@/lib/midtrans/client";
import { supabaseSelect, supabaseSelectAll } from "@/lib/supabase/server";
import {
  parseVolseverRoutesEnv,
  resolveVolseverRoute,
  UNKNOWN_VOLSEVER_ROUTES,
} from "@/lib/volsever/games";

export const runtime = "nodejs";

type ProductTargetRow = {
  id: string;
  game_id: string;
  fulfillment_target_template: string | null;
};

type GameTargetRow = {
  id: string;
  name: string;
  short_name: string | null;
  requires_server: boolean;
  fulfillment_target_template: string | null;
};

type SupplierMappingRow = {
  product_id: string;
};

type Check = {
  id: string;
  label: string;
  scope: "staging" | "production";
  status: "pass" | "warning" | "blocker";
  detail: string;
};

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

/**
 * Kalimat untuk status auto-check.
 *
 * Angka nol harus disebut eksplisit. Dulu pemeriksaan ini hanya melihat API
 * key, jadi panel menampilkan `pass` padahal `VOLSEVER_GAME_ROUTES_JSON` kosong
 * dan tidak ada game yang bisa dicek — gejalanya baru terlihat di halaman
 * checkout.
 */
function checkerGapDescription(
  gap: number,
  routed: number,
  checked: number,
) {
  if (checked === 0) {
    return "Tidak ada game aktif yang memakai auto-check nickname.";
  }
  if (gap === 0) {
    return `${routed}/${checked} game aktif punya route Volsever; sisanya memakai validasi format lokal saja.`;
  }

  const names = UNKNOWN_VOLSEVER_ROUTES.length
    ? ` Route yang ada tapi sedang gagal: ${UNKNOWN_VOLSEVER_ROUTES.join(", ")}.`
    : "";
  return `${gap}/${checked} game aktif memakai checker tanpa route Volsever — nickname tidak akan dicek otomatis, hanya format lokal yang divalidasi.${names}`;
}

function enabled(name: string) {
  return ["true", "1", "yes", "on"].includes(
    process.env[name]?.trim().toLowerCase() ?? "",
  );
}

async function tableExists(table: string) {
  try {
    await supabaseSelect<Record<string, unknown>>(table, {
      select: "*",
      limit: 1,
    });
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const fulfillmentMode = getFulfillmentMode();
  const flowTest = isFlowTestMode();
  const serverMidtransEnvironment = getMidtransEnvironment();
  const publicMidtransEnvironment =
    process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT?.trim().toLowerCase() ===
    "production"
      ? "production"
      : "sandbox";

  const [
    pointsMigration,
    commissionMigration,
    promoMigration,
    profileMigration,
    liveTargetMigration,
    financeMigration,
    rateLimitMigration,
    auditMigration,
    testLabMigration,
    pointsLotsMigration,
    operationsMigration,
    affiliateWithdrawalMigration,
  ] = await Promise.all([
    tableExists("loyalty_accounts"),
    tableExists("commissions"),
    tableExists("promotion_redemptions"),
    tableExists("customer_profiles"),
    supabaseSelect<{ fulfillment_target_template: string | null }>("games", {
      select: "fulfillment_target_template",
      limit: 1,
    })
      .then(() => true)
      .catch(() => false),
    tableExists("financial_reconciliations"),
    tableExists("rate_limit_buckets"),
    tableExists("admin_audit_logs"),
    tableExists("staging_test_lab"),
    tableExists("point_lots"),
    tableExists("operational_incidents"),
    tableExists("affiliate_withdrawal_allocations"),
  ]);

  // PostgREST memotong di ~1000 baris apa pun nilai limit-nya, jadi pakai
  // paginasi penuh agar readiness tidak lolos dari produk/mapping yang terpotong.
  const [activeProducts, activeGames, activeMappings] = await Promise.all([
    supabaseSelectAll<ProductTargetRow>("products", {
      select: "id,game_id,fulfillment_target_template",
      filters: { active: "eq.true" },
      order: "id.asc",
    }),
    supabaseSelectAll<GameTargetRow>("games", {
      // `name`, `short_name`, dan `requires_server` dibutuhkan oleh
      // `getGameAccountSchema` untuk menghitung game mana yang punya checker.
      select: "id,name,short_name,requires_server,fulfillment_target_template",
      filters: { active: "eq.true" },
      order: "id.asc",
    }),
    supabaseSelectAll<SupplierMappingRow>("supplier_products", {
      select: "product_id",
      filters: { active: "eq.true" },
      order: "product_id.asc",
    }),
  ]);

  const gameTargets = new Map(
    activeGames.map((game) => [game.id, game.fulfillment_target_template?.trim() || ""]),
  );
  const mappedProducts = new Set(activeMappings.map((item) => item.product_id));
  const missingSupplierMappings = activeProducts.filter(
    (product) => !mappedProducts.has(product.id),
  );
  const missingTargetTemplates = activeProducts.filter(
    (product) =>
      !(product.fulfillment_target_template?.trim() || gameTargets.get(product.game_id)),
  );

  const liveEnabled =
    enabled("NAMBAH_ALLOW_LIVE_FULFILLMENT") &&
    process.env.NAMBAH_LIVE_FULFILLMENT_ACK?.trim() ===
      "SPEND_REAL_DIGIFLAZZ_BALANCE";
  const midtransServerKey = process.env.MIDTRANS_SERVER_KEY?.trim() ?? "";
  const midtransClientKey =
    process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim() ?? "";
  const digiflazzCallback =
    process.env.DIGIFLAZZ_CALLBACK_URL?.trim() ?? "";
  const brevoEnabled = enabled("BREVO_RECEIPT_ENABLED");

  // Cakupan auto-check nickname.
  //
  // Yang dihitung hanya game aktif yang skemanya memang memakai checker.
  // Game voucher/pulsa/e-wallet tidak punya konsep nickname, jadi tidak boleh
  // dihitung sebagai gap —和刘gua route-nya memang kosong itu normal.
  const checkerEnvRoutes = parseVolseverRoutesEnv(
    process.env.VOLSEVER_GAME_ROUTES_JSON,
  );
  let checkerChecked = 0;
  let checkerRouted = 0;
  for (const game of activeGames) {
    const schema = getGameAccountSchema(game);
    if (!schema.checker) continue;
    checkerChecked += 1;

    // MLBB punya slug yang di-hardcode di route check, jadi selalu routed.
    const route =
      schema.checker === "mobile-legends"
        ? "mobile-legends-wr"
        : resolveVolseverRoute(game.id, checkerEnvRoutes);
    if (route) checkerRouted += 1;
  }
  const checkerGap = checkerChecked - checkerRouted;

  const checks: Check[] = [
    {
      id: "database",
      label: "Supabase server database",
      scope: "staging",
      status:
        configured("SUPABASE_URL") && configured("SUPABASE_SECRET_KEY")
          ? "pass"
          : "blocker",
      detail: "Server database credentials wajib tersedia.",
    },
    {
      id: "midtrans-keys",
      label: "Midtrans keys",
      scope: "staging",
      status:
        midtransServerKey && midtransClientKey ? "pass" : "blocker",
      detail: "Server Key dan Client Key wajib tersedia.",
    },
    {
      id: "digiflazz",
      label: "Digiflazz signed callback",
      scope: "staging",
      status:
        configured("DIGIFLAZZ_USERNAME") &&
        configured("DIGIFLAZZ_API_KEY") &&
        configured("DIGIFLAZZ_WEBHOOK_SECRET") &&
        digiflazzCallback.startsWith("https://")
          ? "pass"
          : "blocker",
      detail: "Credentials dan callback HTTPS wajib lengkap.",
    },
    {
      id: "admin-session",
      label: "Admin session secret",
      scope: "staging",
      status: configured("NAMBAH_ADMIN_SESSION_SECRET")
        ? "pass"
        : "blocker",
      detail: "Browser admin harus memakai signing secret server-only.",
    },
    {
      id: "cron",
      label: "Cron authentication",
      scope: "staging",
      status: configured("CRON_SECRET") ? "pass" : "blocker",
      detail: "Cron endpoints harus dilindungi CRON_SECRET.",
    },
    ...[
      ["migration-points", "Migration 012 Points", pointsMigration],
      ["migration-affiliate", "Migration 013 Affiliate", commissionMigration],
      ["migration-promo", "Migration 014 Promo", promoMigration],
      ["migration-profile", "Migration 015 Profile", profileMigration],
      ["migration-live-target", "Migration 016 Live target", liveTargetMigration],
      ["migration-finance", "Migration 017 Finance", financeMigration],
      ["migration-rate-limit", "Migration 018 Rate limit", rateLimitMigration],
      ["migration-audit", "Migration 018 Audit", auditMigration],
      ["migration-test-lab", "Migration 019 Staging Test Lab", testLabMigration],
      ["migration-points-lots", "Migration 020 Points lots", pointsLotsMigration],
      ["migration-operations", "Migration 022 Operational incidents", operationsMigration],
      ["migration-affiliate-withdrawal", "Migration 024 Affiliate withdrawal", affiliateWithdrawalMigration],
    ].map(([id, label, ok]) => ({
      id: String(id),
      label: String(label),
      scope: "staging" as const,
      status: ok ? ("pass" as const) : ("blocker" as const),
      detail: ok ? "Terdeteksi." : "Belum terdeteksi di database.",
    })),
    {
      id: "live-supplier-mapping",
      label: "Live supplier mapping coverage",
      scope: "production",
      status: missingSupplierMappings.length === 0 ? "pass" : "blocker",
      detail:
        missingSupplierMappings.length === 0
          ? `${activeProducts.length} active products have active supplier mappings.`
          : `${missingSupplierMappings.length} active product(s) have no active supplier mapping.`,
    },
    {
      id: "live-target-template",
      label: "Fulfillment target coverage",
      scope: "production",
      status: missingTargetTemplates.length === 0 ? "pass" : "blocker",
      detail:
        missingTargetTemplates.length === 0
          ? "Every active product resolves an explicit fulfillment target template."
          : `${missingTargetTemplates.length} active product(s) have no product/game fulfillment target template.`,
    },
    {
      id: "midtrans-server-production",
      label: "Midtrans backend production mode",
      scope: "production",
      status:
        serverMidtransEnvironment === "production" &&
        midtransServerKey &&
        !midtransServerKey.startsWith("SB-")
          ? "pass"
          : "blocker",
      detail:
        serverMidtransEnvironment === "production"
          ? "Backend diarahkan ke endpoint production."
          : "MIDTRANS_ENVIRONMENT masih sandbox.",
    },
    {
      id: "midtrans-client-production",
      label: "Midtrans Snap production mode",
      scope: "production",
      status:
        publicMidtransEnvironment === "production" &&
        midtransClientKey &&
        !midtransClientKey.startsWith("SB-")
          ? "pass"
          : "blocker",
      detail:
        publicMidtransEnvironment === "production"
          ? "Browser memakai Snap production."
          : "NEXT_PUBLIC_MIDTRANS_ENVIRONMENT masih sandbox.",
    },
    {
      id: "midtrans-env-match",
      label: "Midtrans environment parity",
      scope: "production",
      status:
        serverMidtransEnvironment === publicMidtransEnvironment
          ? "pass"
          : "blocker",
      detail:
        serverMidtransEnvironment === publicMidtransEnvironment
          ? "Backend dan Snap memakai environment yang sama."
          : "Backend dan browser Midtrans berbeda environment.",
    },
    {
      id: "flow-test-off",
      label: "Flow test disabled",
      scope: "production",
      status: flowTest ? "blocker" : "pass",
      detail: flowTest
        ? "NAMBAH_FLOW_TEST_MODE masih aktif."
        : "Flow test dimatikan.",
    },
    {
      id: "live-fulfillment",
      label: "Digiflazz live fulfillment",
      scope: "production",
      status:
        fulfillmentMode === "digiflazz-live" && liveEnabled
          ? "pass"
          : "blocker",
      detail:
        fulfillmentMode === "digiflazz-live" && liveEnabled
          ? "Live mode + double explicit opt-in aktif."
          : "Live money tetap terkunci.",
    },
    {
      id: "rate-limit-secret",
      label: "Rate-limit privacy secret",
      scope: "production",
      status: configured("NAMBAH_RATE_LIMIT_SECRET")
        ? "pass"
        : "blocker",
      detail: "Production wajib memakai pseudonymous rate-limit salt.",
    },
    {
      id: "brevo",
      label: "Transactional receipt",
      scope: "production",
      status:
        brevoEnabled &&
        configured("BREVO_API_KEY") &&
        configured("BREVO_SENDER_EMAIL")
          ? "pass"
          : "blocker",
      detail: brevoEnabled
        ? "Brevo receipt diaktifkan."
        : "BREVO_RECEIPT_ENABLED belum aktif.",
    },
    {
      id: "telegram",
      label: "Operational alerts",
      scope: "production",
      status:
        configured("TELEGRAM_BOT_TOKEN") &&
        configured("TELEGRAM_ADMIN_CHAT_ID")
          ? "pass"
          : "warning",
      detail: "Telegram alerts direkomendasikan sebelum live traffic.",
    },
    {
      id: "universal-checker",
      label: "Universal account checker routing",
      scope: "production",
      // API key saja tidak cukup. Kalau `VOLSEVER_GAME_ROUTES_JSON` kosong dan
      // peta bawaan tidak mencakup game aktif mana pun, tidak ada satu pun
      // nickname yang bisa dicek — tapi pemeriksaan lama tetap melaporkannya
      // `pass` hanya karena key-nya terisi.
      status: !configured("VOLSEVER_API_KEY")
        ? "warning"
        : checkerGap > 0
          ? "warning"
          : "pass",
      detail: checkerGapDescription(checkerGap, checkerRouted, checkerChecked),
    },
  ];

  const stagingChecks = checks.filter((check) => check.scope === "staging");
  const productionChecks = checks.filter(
    (check) => check.scope === "production",
  );
  const stagingBlockers = stagingChecks.filter(
    (check) => check.status === "blocker",
  ).length;
  const productionBlockers = [
    ...stagingChecks,
    ...productionChecks,
  ].filter((check) => check.status === "blocker").length;
  const warnings = checks.filter(
    (check) => check.status === "warning",
  ).length;

  return Response.json({
    version: "1.0.0",
    stage: "stable-code",
    readyForStagingE2E: stagingBlockers === 0,
    automatedProductionReady: productionBlockers === 0,
    blockers: productionBlockers,
    stagingBlockers,
    warnings,
    fulfillmentMode,
    flowTest,
    midtransEnvironment: {
      server: serverMidtransEnvironment,
      client: publicMidtransEnvironment,
    },
    catalogCoverage: {
      activeProducts: activeProducts.length,
      missingSupplierMappings: missingSupplierMappings.map((item) => item.id).slice(0, 50),
      missingTargetTemplates: missingTargetTemplates.map((item) => item.id).slice(0, 50),
    },
    manualChecklist: [
      "Midtrans Payment Notification URL mengarah ke /api/webhooks/midtrans.",
      "Digiflazz callback URL mengarah ke /api/webhooks/digiflazz dan secret cocok.",
      "Supabase Auth Site URL/Redirect URL memakai domain production.",
      "Brevo sender/domain sudah authenticated.",
      "Semua SKU live dan fulfillment_target_template diverifikasi per produk/game.",
      "Lakukan satu transaksi real bernilai kecil setelah approval owner sebelum membuka traffic.",
    ],
    checks,
  });
}
