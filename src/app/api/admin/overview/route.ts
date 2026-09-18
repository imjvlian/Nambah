import { authorizeAdminRequest } from "@/lib/admin-api";
import { isFlowTestMode } from "@/lib/flow-test";
import { getFulfillmentMode } from "@/lib/fulfillment";
import {
  isSupabaseConfigured,
  supabaseSelect,
  supabaseSelectPage,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type OrderRow = {
  id: string;
  status: string;
  final_price: number | string;
  target_user_id: string;
  target_server_id: string | null;
  receipt_email: string | null;
  created_at: string;
  updated_at: string;
  game: { name: string; short_name: string } | null;
  product: { label: string } | null;
};

type BalanceRow = {
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function enabled(name: string) {
  return ["true", "1", "yes", "on"].includes(
    process.env[name]?.trim().toLowerCase() ?? "",
  );
}

async function countRows(
  table: string,
  select: string,
  filters?: Record<string, string>,
) {
  const result = await supabaseSelectPage<Record<string, unknown>>(table, {
    select,
    filters,
    limit: 1,
  });
  return result.count ?? 0;
}

async function safeCount(
  table: string,
  select: string,
  filters?: Record<string, string>,
) {
  try {
    return await countRows(table, select, filters);
  } catch {
    return null;
  }
}

function service(
  id: string,
  name: string,
  ready: boolean,
  detail: string,
  state: "live" | "test" | "planned" | "attention" = ready ? "live" : "attention",
) {
  return { id, name, ready, detail, state };
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Database Nambah belum dikonfigurasi." },
      { status: 503 },
    );
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [
      recentOrders,
      successfulToday,
      balanceRows,
      ordersToday,
      successToday,
      pendingPayment,
      processing,
      failed,
      receiptsSent,
      receiptsFailed,
      activePromotions,
      activeAffiliates,
    ] = await Promise.all([
      supabaseSelect<OrderRow>("orders", {
        select:
          "id,status,final_price,target_user_id,target_server_id,receipt_email,created_at,updated_at,game:games(name,short_name),product:products(label)",
        order: "created_at.desc",
        limit: 10,
      }),
      supabaseSelect<{ final_price: number | string }>("orders", {
        select: "final_price",
        filters: {
          status: "eq.success",
          created_at: `gte.${todayIso}`,
        },
        limit: 1000,
      }),
      supabaseSelect<BalanceRow>("supplier_balances", {
        select: "balance,reserved_balance,checked_at",
        filters: { supplier_id: "eq.digiflazz" },
        limit: 1,
      }),
      safeCount("orders", "id", { created_at: `gte.${todayIso}` }),
      safeCount("orders", "id", {
        status: "eq.success",
        created_at: `gte.${todayIso}`,
      }),
      safeCount("orders", "id", { status: "eq.pending_payment" }),
      safeCount("orders", "id", { status: "eq.processing" }),
      safeCount("orders", "id", { status: "eq.failed" }),
      safeCount("receipt_deliveries", "id", {
        channel: "eq.email",
        status: "eq.sent",
      }),
      safeCount("receipt_deliveries", "id", {
        channel: "eq.email",
        status: "eq.failed",
      }),
      safeCount("promotions", "code", { active: "eq.true" }),
      safeCount("affiliates", "code", { status: "eq.active" }),
    ]);

    const balance = balanceRows[0];
    const balanceValue = Number(balance?.balance ?? 0);
    const reservedBalance = Number(balance?.reserved_balance ?? 0);
    const fulfillmentMode = getFulfillmentMode();
    const flowTest = isFlowTestMode();
    const brevoReady =
      enabled("BREVO_RECEIPT_ENABLED") &&
      configured("BREVO_API_KEY") &&
      configured("BREVO_SENDER_EMAIL");

    return Response.json({
      generatedAt: new Date().toISOString(),
      stats: {
        ordersToday,
        successToday,
        pendingPayment,
        processing,
        failed,
        receiptsSent,
        receiptsFailed,
        activePromotions,
        activeAffiliates,
      },
      finance: {
        gmvToday: successfulToday.reduce(
          (sum, row) => sum + Number(row.final_price || 0),
          0,
        ),
        supplierBalance: balanceValue,
        reservedBalance,
        availableBalance: Math.max(0, balanceValue - reservedBalance),
        balanceCheckedAt: balance?.checked_at ?? null,
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        status: order.status,
        finalPrice: Number(order.final_price),
        targetUserId: order.target_user_id,
        targetServerId: order.target_server_id,
        hasReceiptEmail: Boolean(order.receipt_email),
        gameName: order.game?.name ?? order.game?.short_name ?? "Produk digital",
        packageLabel: order.product?.label ?? "-",
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      })),
      system: {
        flowTest,
        fulfillmentMode,
        services: [
          service(
            "database",
            "Supabase Database",
            true,
            "Catalog, pricing, order, dan operasional server.",
          ),
          service(
            "midtrans",
            "Midtrans",
            configured("MIDTRANS_SERVER_KEY"),
            configured("MIDTRANS_SERVER_KEY")
              ? "Sandbox payment verification siap."
              : "MIDTRANS_SERVER_KEY belum terpasang.",
            flowTest ? "test" : configured("MIDTRANS_SERVER_KEY") ? "live" : "attention",
          ),
          service(
            "digiflazz",
            "Digiflazz",
            configured("DIGIFLAZZ_USERNAME") && configured("DIGIFLAZZ_API_KEY"),
            fulfillmentMode === "simulate"
              ? "Fulfillment sedang memakai simulasi aman."
              : `Fulfillment mode: ${fulfillmentMode}.`,
            fulfillmentMode === "simulate" || fulfillmentMode === "digiflazz-test"
              ? "test"
              : configured("DIGIFLAZZ_USERNAME") && configured("DIGIFLAZZ_API_KEY")
                ? "live"
                : "attention",
          ),
          service(
            "brevo",
            "Brevo Receipt",
            brevoReady,
            brevoReady
              ? "Transactional receipt aktif."
              : "Receipt belum aktif atau konfigurasi sender/API belum lengkap.",
          ),
          service(
            "volsever",
            "Volsever Checker",
            configured("VOLSEVER_API_KEY"),
            configured("VOLSEVER_API_KEY")
              ? "Account checker tersedia."
              : "VOLSEVER_API_KEY belum terpasang.",
          ),
          service(
            "telegram",
            "Telegram Alerts",
            configured("TELEGRAM_BOT_TOKEN") &&
              configured("TELEGRAM_ADMIN_CHAT_ID"),
            configured("TELEGRAM_BOT_TOKEN") &&
              configured("TELEGRAM_ADMIN_CHAT_ID")
              ? "Alert admin siap."
              : "Alert Telegram belum dikonfigurasi.",
          ),
        ],
      },
    });
  } catch (error) {
    console.error("Admin overview failed", error);
    return Response.json(
      { error: "Overview admin tidak dapat dimuat." },
      { status: 502 },
    );
  }
}
