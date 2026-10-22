import type { PublicOrderStatus } from "@/lib/order-public";
import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

type CommissionOrderRow = {
  id: string;
  affiliate_code: string | null;
  tier2_affiliate_code: string | null;
  tier2_rate: number | string | null;
  tier2_commission: number | string | null;
  status: PublicOrderStatus;
  net_profit_before_affiliate: number | string;
  affiliate_rate: number | string;
  affiliate_commission: number | string;
};

type CommissionRow = {
  id: number;
  affiliate_code: string;
  order_id: string;
  tier: number;
  base_profit: number | string;
  rate: number | string;
  amount: number | string;
  status: "pending" | "available" | "withdrawn" | "cancelled";
  available_at: string | null;
  created_at: string;
  updated_at: string;
};

type TierSnapshot = {
  tier: 1 | 2;
  code: string;
  rate: number;
  amount: number;
};

/**
 * Sinkronkan siklus komisi order ke tabel commissions (P2: dua tier).
 *
 * Sumber kebenaran adalah snapshot di orders — pola yang sudah terbukti
 * untuk tier-1 (affiliate_code/rate/commission), diperluas dengan
 * tier2_affiliate_code/tier2_rate/tier2_commission. Fungsi ini STATE-BASED:
 * membaca state order lalu membuat baris komisi yang cocok, dipanggil ulang
 * di setiap transisi status — bukan event-based — sehingga panggilan yang
 * terlewat (mis. saat jendela deploy) disembuhkan panggilan berikutnya.
 *
 * Invariant (migrasi 060): satu baris per (order_id, tier). Tier-2 hanya
 * ada kalau snapshot tier-2 di order ada — order pra-060 tidak pernah
 * punya. Kedua baris dibatalkan bersama saat refund/gagal (update by
 * order_id menutup keduanya sekaligus), dan masing-masing menahan masa
 * tunggu 3 hari yang sama (047, via available_at).
 *
 * Pencairan (RPC migrasi 024) bekerja per affiliate_code, jadi baris
 * tier-2 milik upline otomatis masuk saldo + alokasi FIFO upline tanpa
 * perubahan RPC.
 */
export async function syncOrderCommissionLifecycle(
  orderId: string,
  status?: PublicOrderStatus,
) {
  const [order] = await supabaseSelect<CommissionOrderRow>("orders", {
    select:
      "id,affiliate_code,tier2_affiliate_code,tier2_rate,tier2_commission,status,net_profit_before_affiliate,affiliate_rate,affiliate_commission",
    filters: { id: "eq." + orderId },
    limit: 1,
  });

  if (!order || !order.affiliate_code) return null;

  const baseProfit = Number(order.net_profit_before_affiliate);
  const targetStatus = status ?? order.status;
  const now = new Date().toISOString();

  const tiers: TierSnapshot[] = [
    {
      tier: 1,
      code: order.affiliate_code,
      rate: Math.max(0, Number(order.affiliate_rate)),
      amount: Math.max(0, Number(order.affiliate_commission)),
    },
  ];
  if (order.tier2_affiliate_code) {
    tiers.push({
      tier: 2,
      code: order.tier2_affiliate_code,
      rate: Math.max(0, Number(order.tier2_rate ?? 0)),
      amount: Math.max(0, Number(order.tier2_commission ?? 0)),
    });
  }

  const existingRows = await supabaseSelect<CommissionRow>("commissions", {
    select:
      "id,affiliate_code,order_id,tier,base_profit,rate,amount,status,available_at,created_at,updated_at",
    filters: { order_id: "eq." + orderId },
    limit: tiers.length,
  });
  const existingByTier = new Map(existingRows.map((row) => [row.tier, row]));

  // Order belum dibayar: jangan buat apa pun — baris pending menunggu
  // transisi berbayar pertama.
  if (targetStatus === "pending_payment") {
    return existingByTier.get(1) ?? null;
  }

  if (targetStatus === "paid" || targetStatus === "processing") {
    for (const snapshot of tiers) {
      // B2: tanpa komisi tier-1 tidak ada tier-2; tier tanpa nominal
      // tidak pernah menjadi baris.
      if (snapshot.tier === 2 && !(tiers[0].amount > 0)) continue;
      if (!(snapshot.amount > 0) || !(snapshot.rate > 0)) continue;

      // Sudah dicairkan: baris ini milik riwayat pencairan, jangan disentuh.
      const existing = existingByTier.get(snapshot.tier);
      if (existing?.status === "withdrawn") continue;

      await supabaseUpsert(
        "commissions",
        {
          affiliate_code: snapshot.code,
          order_id: orderId,
          tier: snapshot.tier,
          base_profit: baseProfit,
          rate: snapshot.rate,
          amount: snapshot.amount,
          status: existing?.status === "available" ? "available" : "pending",
          available_at: existing?.available_at ?? null,
          updated_at: now,
        },
        {
          onConflict: "order_id,tier",
          prefer: "resolution=merge-duplicates,return=representation",
        },
      );
    }
  } else if (targetStatus === "success") {
    for (const snapshot of tiers) {
      if (snapshot.tier === 2 && !(tiers[0].amount > 0)) continue;
      if (!(snapshot.amount > 0) || !(snapshot.rate > 0)) continue;

      const existing = existingByTier.get(snapshot.tier);
      if (existing?.status === "withdrawn") continue;

      await supabaseUpsert(
        "commissions",
        {
          affiliate_code: snapshot.code,
          order_id: orderId,
          tier: snapshot.tier,
          base_profit: baseProfit,
          rate: snapshot.rate,
          amount: snapshot.amount,
          status: "available",
          available_at: existing?.available_at ?? now,
          updated_at: now,
        },
        {
          onConflict: "order_id,tier",
          prefer: "resolution=merge-duplicates,return=representation",
        },
      );
    }
  } else if (
    targetStatus === "failed" ||
    targetStatus === "refunded" ||
    targetStatus === "cancelled"
  ) {
    // Satu update by order_id membatalkan kedua tier sekaligus.
    if (existingRows.length > 0) {
      await supabaseUpdate(
        "commissions",
        {
          status: "cancelled",
          available_at: null,
          updated_at: now,
        },
        {
          filters: {
            order_id: "eq." + orderId,
            status: "in.(pending,available)",
          },
        },
      );
    }
  }

  // Kontrak lama dipertahankan: pemanggil menerima baris tier-1.
  const [current] = await supabaseSelect<CommissionRow>("commissions", {
    select:
      "id,affiliate_code,order_id,tier,base_profit,rate,amount,status,available_at,created_at,updated_at",
    filters: { order_id: "eq." + orderId, tier: "eq.1" },
    limit: 1,
  });
  return current ?? null;
}
