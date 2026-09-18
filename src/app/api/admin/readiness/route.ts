import { authorizeAdminRequest } from "@/lib/admin-api";
import { getFulfillmentMode } from "@/lib/fulfillment";
import { isFlowTestMode } from "@/lib/flow-test";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Check = {
  id: string;
  label: string;
  status: "pass" | "warning" | "blocker";
  detail: string;
};

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
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

  const [
    pointsMigration,
    commissionMigration,
    promoMigration,
    profileMigration,
    liveTargetMigration,
    financeMigration,
    rateLimitMigration,
    auditMigration,
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
  ]);

  const liveEnabled =
    process.env.NAMBAH_ALLOW_LIVE_FULFILLMENT?.trim().toLowerCase() ===
      "true" &&
    process.env.NAMBAH_LIVE_FULFILLMENT_ACK?.trim() ===
      "SPEND_REAL_DIGIFLAZZ_BALANCE";

  const checks: Check[] = [
    {
      id: "database",
      label: "Supabase server database",
      status:
        configured("SUPABASE_URL") && configured("SUPABASE_SECRET_KEY")
          ? "pass"
          : "blocker",
      detail: "Server database credentials wajib tersedia.",
    },
    {
      id: "midtrans",
      label: "Midtrans",
      status:
        configured("MIDTRANS_SERVER_KEY") &&
        configured("NEXT_PUBLIC_MIDTRANS_CLIENT_KEY")
          ? "pass"
          : "blocker",
      detail: "Server key dan client key harus terpasang.",
    },
    {
      id: "digiflazz",
      label: "Digiflazz",
      status:
        configured("DIGIFLAZZ_USERNAME") &&
        configured("DIGIFLAZZ_API_KEY") &&
        configured("DIGIFLAZZ_WEBHOOK_SECRET") &&
        configured("DIGIFLAZZ_CALLBACK_URL")
          ? "pass"
          : "blocker",
      detail: "Credentials + signed public callback wajib lengkap.",
    },
    {
      id: "cron",
      label: "Cron authentication",
      status: configured("CRON_SECRET") ? "pass" : "warning",
      detail: "CRON_SECRET melindungi reconciliation/monitor endpoints.",
    },
    {
      id: "rate-limit-secret",
      label: "Rate-limit privacy secret",
      status: configured("NAMBAH_RATE_LIMIT_SECRET")
        ? "pass"
        : "warning",
      detail:
        "Limiter tetap bekerja tanpa secret, tetapi secret direkomendasikan untuk pseudonymous client keys.",
    },
    {
      id: "flow-test",
      label: "Flow test",
      status: flowTest ? "warning" : "pass",
      detail: flowTest
        ? "Staging mode aktif; jangan dianggap production live."
        : "Flow test dimatikan.",
    },
    {
      id: "live-money",
      label: "Live fulfillment gate",
      status:
        fulfillmentMode !== "digiflazz-live"
          ? "warning"
          : liveEnabled
            ? "pass"
            : "blocker",
      detail:
        fulfillmentMode === "digiflazz-live"
          ? "Live mode membutuhkan dua explicit opt-in."
          : "Live money masih OFF; aman untuk staging.",
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
    ].map(([id, label, ok]) => ({
      id: String(id),
      label: String(label),
      status: ok ? ("pass" as const) : ("blocker" as const),
      detail: ok ? "Terdeteksi." : "Belum terdeteksi di database.",
    })),
  ];

  const blockers = checks.filter((check) => check.status === "blocker").length;
  const warnings = checks.filter((check) => check.status === "warning").length;

  return Response.json({
    stage: "staging-readiness",
    readyForStagingE2E: blockers === 0,
    blockers,
    warnings,
    fulfillmentMode,
    flowTest,
    checks,
  });
}
