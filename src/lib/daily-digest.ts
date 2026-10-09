import {
  escapeTelegramHtml,
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";
import {
  formatWibDateLabel,
  previousWibDateKey,
  wibDateKey,
  wibDayWindow,
} from "@/lib/time-wib";
import {
  supabaseSelect,
  supabaseSelectAll,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";
import { gameDisplayName } from "@/lib/game-display-name";
import { BRAND } from "@/lib/brand";

/**
 * Digest harian ke Telegram.
 *
 * Dua aturan yang dipegang:
 *
 * 1. Isinya agregat saja. Tidak ada email, WhatsApp, `target_user_id`, atau
 *    kode referral pelanggan. Chat ini Though tidak publik, tetap tidak perlu
 *    memuat data pribadi orang.
 * 2. Satu tanggal satu pengiriman. `telegram_digest_runs.digest_date` jadi
 *    primary key, jadi timer yang terpicu dua kali — atau worker yang restart
 *    di tengah jalan — tidak mengirim ulang hari yang sama.
 */

type DigestOrderRow = {
  id: string;
  status: string;
  game_id: string;
  final_price: number | string;
  supplier_cost: number | string;
  nambah_profit: number | string;
  affiliate_commission: number | string;
  promotion_discount: number | string;
  referral_discount: number | string;
  points_discount: number | string;
};

type DigestGameRow = { id: string; name: string };
type DigestTransactionRow = { status: string; cost: number | string };
type DigestReceiptRow = { status: string };
type DigestIncidentRow = {
  fingerprint: string;
  severity: string;
  title: string;
  detail: string;
  occurrence_count: number | string;
};
type DigestBalanceRow = {
  status: string;
  balance: number | string;
  reserved_balance: number | string;
};
type DigestRunRow = { digest_date: string; status: string };

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Belum bayar",
  paid: "Sudah bayar",
  processing: "Diproses",
  success: "Sukses",
  failed: "Gagal",
  refunded: "Refund",
  cancelled: "Batal",
};

function n(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export type DailyDigest = {
  dateKey: string;
  window: { start: string; end: string };
  totals: {
    created: number;
    successful: number;
    byStatus: Record<string, number>;
    revenue: number;
    profit: number;
    supplierCost: number;
    affiliateCommission: number;
    promotionDiscount: number;
    referralDiscount: number;
    pointsDiscount: number;
  };
  topGames: Array<{ name: string; orders: number; revenue: number }>;
  supplier: { success: number; failed: number; pending: number; cost: number };
  receipts: { sent: number; failed: number; sending: number };
  incidents: Array<{
    fingerprint: string;
    severity: string;
    title: string;
    detail: string;
    count: number;
  }>;
  balance: { status: string; balance: number; reservedBalance: number } | null;
  catalog: { products: number; unmapped: number };
};

export async function buildDailyDigest(dateKey: string): Promise<DailyDigest> {
  const window = wibDayWindow(dateKey);
  // Dua filter untuk kolom yang sama harus lewat operator logis `and`, karena
  // object filter akan menimpa key-nya. NILAI HARUS DI-KUOTE: timestamp ISO
  // punya titik (`.000Z`) dan tanpa kutipan PostgREST memotongnya di titik itu
  // lalu mengembalikan 0 baris tanpa error — diam-diam salah.
  const windowQuery = {
    and: `(created_at.gte."${window.start}",created_at.lt."${window.end}")`,
  };

  const [orders, games, transactions, receiptRows, incidents, balance, products, supplierProducts] =
    await Promise.all([
      // `supabaseSelectAll`, bukan `supabaseSelect`: yang latter diam-diam
      // terpotong 1000 baris, dan order harian bisa lewat itu.
      supabaseSelectAll<DigestOrderRow>(
        "orders",
        {
          select:
            "id,status,game_id,final_price,supplier_cost,nambah_profit,affiliate_commission,promotion_discount,referral_discount,points_discount",
          query: windowQuery,
        },
        20_000,
      ),
      supabaseSelectAll<DigestGameRow>("games", { select: "id,name" }),
      supabaseSelectAll<DigestTransactionRow>(
        "supplier_transactions",
        { select: "status,cost", query: windowQuery },
        20_000,
      ),
      supabaseSelectAll<DigestReceiptRow>(
        "receipt_deliveries",
        { select: "status", query: windowQuery },
        20_000,
      ),
      supabaseSelect<DigestIncidentRow>("operational_incidents", {
        select: "fingerprint,severity,title,detail,occurrence_count",
        filters: { status: "eq.open" },
        order: "last_seen_at.desc",
        limit: 10,
      }),
      supabaseSelect<DigestBalanceRow>("supplier_balance_snapshots", {
        select: "status,balance,reserved_balance",
        filters: { supplier_id: "eq.digiflazz" },
        order: "checked_at.desc",
        limit: 1,
      }),
      supabaseSelectAll<{ id: string }>("products", { select: "id" }),
      supabaseSelectAll<{ product_id: string }>("supplier_products", {
        select: "product_id",
      }),
    ]);

  const gameName = new Map(
    games.map((game) => [game.id, gameDisplayName(game.id, game.name)]),
  );

  const byStatus: Record<string, number> = {};
  const revenueByGame = new Map<string, { orders: number; revenue: number }>();
  const totals = {
    created: orders.length,
    successful: 0,
    revenue: 0,
    profit: 0,
    supplierCost: 0,
    affiliateCommission: 0,
    promotionDiscount: 0,
    referralDiscount: 0,
    pointsDiscount: 0,
  };

  for (const order of orders) {
    byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;

    // Omzet dan profit hanya dari order `success`. Order `pending_payment` bukan
    // pendapatan, dan `failed`/`cancelled` berarti uang tidak masuk.
    if (order.status !== "success") continue;

    const revenue = n(order.final_price);
    totals.successful += 1;
    totals.revenue += revenue;
    totals.profit += n(order.nambah_profit);
    totals.supplierCost += n(order.supplier_cost);
    totals.affiliateCommission += n(order.affiliate_commission);
    totals.promotionDiscount += n(order.promotion_discount);
    totals.referralDiscount += n(order.referral_discount);
    totals.pointsDiscount += n(order.points_discount);

    const bucket = revenueByGame.get(order.game_id) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += revenue;
    revenueByGame.set(order.game_id, bucket);
  }

  const topGames = [...revenueByGame.entries()]
    .map(([gameId, bucket]) => ({
      // `?? gameId` pernah jadi tempat `lifeafter-credits` bocor ke pesan
      // Telegram. Sekarang `gameName` sudah berisi override, jadi saat game
      // tidak ditemukan di DB pun yang tampil tetap nama yang bisa dibaca.
      name: gameName.get(gameId) ?? gameDisplayName(gameId, gameId),
      orders: bucket.orders,
      revenue: bucket.revenue,
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 5);

  const supplier = { success: 0, failed: 0, pending: 0, cost: 0 };
  for (const transaction of transactions) {
    if (transaction.status === "success") supplier.success += 1;
    else if (transaction.status === "failed") supplier.failed += 1;
    else supplier.pending += 1;
    supplier.cost += n(transaction.cost);
  }

  const receipts = { sent: 0, failed: 0, sending: 0 };
  for (const receipt of receiptRows) {
    if (receipt.status === "sent") receipts.sent += 1;
    else if (receipt.status === "failed") receipts.failed += 1;
    else if (receipt.status === "sending") receipts.sending += 1;
  }

  // Dihitung dari `supplier_products.product_id`, bukan dari jumlah SKU: satu
  // SKU bisa ter-map ke produk di game lain, jadi menghitung selisih
  // "produk - SKU" bisa salah.
  const mappedProducts = new Set(supplierProducts.map((row) => row.product_id));

  const latestBalance = balance[0] ?? null;

  return {
    dateKey,
    window,
    totals: { ...totals, byStatus },
    topGames,
    supplier,
    receipts,
    incidents: incidents.map((incident) => ({
      fingerprint: incident.fingerprint,
      severity: incident.severity,
      title: incident.title,
      detail: incident.detail,
      count: Number(incident.occurrence_count ?? 0),
    })),
    balance: latestBalance
      ? {
          status: latestBalance.status,
          balance: n(latestBalance.balance),
          reservedBalance: n(latestBalance.reserved_balance),
        }
      : null,
    catalog: {
      products: products.length,
      unmapped: products.filter((product) => !mappedProducts.has(product.id)).length,
    },
  };
}

export function formatDailyDigest(digest: DailyDigest) {
  const label = formatWibDateLabel(digest.dateKey);
  const lines: string[] = [
    `<b>Digest Harian {BRAND.name}</b> — ${escapeTelegramHtml(label)}`,
    "",
    `Omzet: ${escapeTelegramHtml(rupiah(digest.totals.revenue))}`,
    `Profit {BRAND.shortName}: ${escapeTelegramHtml(rupiah(digest.totals.profit))}`,
    `Modal supplier: ${escapeTelegramHtml(rupiah(digest.totals.supplierCost))}`,
    `Order sukses: ${digest.totals.successful} dari ${digest.totals.created} dibuat`,
    "",
  ];

  const statusLines = Object.entries(digest.totals.byStatus)
    .sort((left, right) => right[1] - left[1])
    .map(([status, count]) => `  ${STATUS_LABELS[status] ?? status}: ${count}`);
  if (statusLines.length > 0) {
    lines.push("Order per status:");
    lines.push(...statusLines);
    lines.push("");
  }

  if (digest.topGames.length > 0) {
    lines.push("Game teratas:");
    for (const game of digest.topGames) {
      lines.push(
        `  ${escapeTelegramHtml(game.name)} — ${game.orders} order, ${escapeTelegramHtml(rupiah(game.revenue))}`,
      );
    }
    lines.push("");
  }

  lines.push("Supplier:");
  lines.push(
    `  Sukses ${digest.supplier.success}, gagal ${digest.supplier.failed}, pending ${digest.supplier.pending}`,
  );
  if (digest.balance) {
    lines.push(
      `  Saldo ${escapeTelegramHtml(rupiah(digest.balance.balance))} (${escapeTelegramHtml(digest.balance.status)})`,
    );
  }
  lines.push("");

  lines.push("Receipt:");
  lines.push(
    `  Terkirim ${digest.receipts.sent}, gagal ${digest.receipts.failed}, jalan ${digest.receipts.sending}`,
  );
  lines.push("");

  lines.push("Katalog:");
  lines.push(
    `  ${digest.catalog.products} produk, ${digest.catalog.unmapped} tanpa mapping`,
  );
  lines.push("");

  if (digest.incidents.length > 0) {
    lines.push(`Incident terbuka (${digest.incidents.length}):`);
    for (const incident of digest.incidents.slice(0, 5)) {
      lines.push(
        `  [${escapeTelegramHtml(incident.severity)}] ${escapeTelegramHtml(incident.title)} — ${escapeTelegramHtml(incident.detail)}`,
      );
    }
  } else {
    lines.push("Incident terbuka: tidak ada.");
  }

  return lines.join("\n");
}

/**
 * Kirim digest untuk satu tanggal WIB.
 *
 * `force` dipakai endpoint admin untuk mengulang tanggal yang gagal terkirim;
 * tanpa itu, tanggal yang sudah `sent` dilewati.
 */
export async function sendDailyDigest(options?: { dateKey?: string; force?: boolean }) {
  if (!isTelegramConfigured()) {
    return { sent: false as const, reason: "not-configured" as const };
  }

  const dateKey = options?.dateKey ?? previousWibDateKey(wibDateKey(new Date()));
  const window = wibDayWindow(dateKey);

  const existing = await supabaseSelect<DigestRunRow>("telegram_digest_runs", {
    select: "digest_date,status",
    filters: { digest_date: `eq.${dateKey}` },
    limit: 1,
  });

  if (existing[0]?.status === "sent" && !options?.force) {
    return { sent: false as const, reason: "already-sent" as const, dateKey };
  }

  const digest = await buildDailyDigest(dateKey);
  const message = formatDailyDigest(digest);

  // Catat lebih dulu sebagai `pending`: kalau proses mati di tengah jalan,
  // tanggal ini tidak terkirim ulang tanpa jejak.
  await supabaseUpsert(
    "telegram_digest_runs",
    {
      digest_date: dateKey,
      window_start: window.start,
      window_end: window.end,
      status: "pending",
      message_preview: message.replace(/\s+/g, " ").slice(0, 240),
      payload: digest as unknown as Record<string, unknown>,
      error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "digest_date" },
  );

  try {
    await sendTelegramMessage(message, {
      kind: "digest",
      // Diberi presisi menit supaya dua percobaan di hari yang sama tetap
      // tercatat terpisah di log pengiriman.
      dedupeKey: `digest:${dateKey}:${new Date().toISOString().slice(0, 16)}`,
      parseMode: "HTML",
    });

    await supabaseUpdate(
      "telegram_digest_runs",
      { status: "sent", error: null, updated_at: new Date().toISOString() },
      { filters: { digest_date: `eq.${dateKey}` } },
    );

    return { sent: true as const, dateKey, digest };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await supabaseUpdate(
      "telegram_digest_runs",
      {
        status: "failed",
        error: failure.slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { filters: { digest_date: `eq.${dateKey}` } },
    );
    throw error;
  }
}