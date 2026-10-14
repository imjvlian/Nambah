import { supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import { supplierLabel } from "@/lib/fulfillment-alert-text";
import {
  buildBalanceAlertMessage,
  decideBalanceNotify,
  getStatus,
  type BalanceSkipReason,
  type SupplierBalanceStatus,
} from "@/lib/supplier-balance-alert-text";
import { tryGetSupplierClient, usableSupplierIds } from "@/lib/suppliers/registry";
import type { SupplierId } from "@/lib/suppliers/types";

// Efek samping: mengisi registry dengan klien Digiflazz dan Melostore.
// Tanpa baris ini, `usableSupplierIds()` mengembalikan kosong dan cek
// saldo Melostore gagal dengan "belum dikonfigurasi" padahal
// kredensialnya lengkap. Modul ini tidak melakukan I/O saat dimuat.
import "@/lib/suppliers/register-suppliers";

export type { SupplierBalanceStatus };
export type SupplierBalanceCheckSource = "manual" | "periodic" | "transaction";

type SupplierBalanceRow = {
  supplier_id: string;
  balance: number | string;
  reserved_balance: number | string;
  checked_at: string;
};

type SupplierBalanceSnapshotRow = {
  status: SupplierBalanceStatus | "unknown";
  checked_at: string;
};

type PricingRuleRow = {
  target_supplier_balance: number | string;
  low_supplier_balance: number | string;
  critical_supplier_balance: number | string;
};

/**
 * Cek saldo satu supplier, lalu simpan snapshot dan (kalau diminta)
 * kirim alert saat statusnya berubah.
 *
 * Dibuat generik karena nama supplier bukan lagi konstanta: Melostore
 * dipantau dengan ambang dan pesan yang sama seperti Digiflazz, dan
 * versi lama yang menulis "Digiflazz" ke dalam teks pesan akan
 * mengirim alert Melostore berlabel Digiflazz.
 */
export async function checkSupplierBalance(
  supplierId: SupplierId,
  input?: {
    source?: SupplierBalanceCheckSource;
    notify?: boolean;
  },
) {
  const source = input?.source ?? "manual";
  const notify = input?.notify === true;
  const label = supplierLabel(supplierId);

  const client = tryGetSupplierClient(supplierId);
  if (!client) {
    throw new Error(`Supplier ${label} belum dikonfigurasi, saldo tidak bisa dicek.`);
  }

  const [currentRows, previousSnapshots, pricingRows, balance, sandboxMode] =
    await Promise.all([
    supabaseSelect<SupplierBalanceRow>("supplier_balances", {
      select: "supplier_id,balance,reserved_balance,checked_at",
      filters: { supplier_id: `eq.${supplierId}` },
      limit: 1,
    }),
    supabaseSelect<SupplierBalanceSnapshotRow>("supplier_balance_snapshots", {
      select: "status,checked_at",
      filters: { supplier_id: `eq.${supplierId}` },
      order: "checked_at.desc",
      limit: 1,
    }),
    supabaseSelect<PricingRuleRow>("pricing_rules", {
      select: "target_supplier_balance,low_supplier_balance,critical_supplier_balance",
      filters: { id: "eq.default" },
      limit: 1,
    }),
    client.fetchBalance(),
    /*
     * `sandboxMode?.()` opsional: supplier tanpa konsep sandbox tidak
     * punya method ini, jadi hasilnya selalu boolean. Kegagalan dibaca
     * sebagai "bukan sandbox" - lebih baik satu alert berlebih daripada
     * alert kritis yang tidak pernah terkirim.
     */
    client.sandboxMode ? client.sandboxMode().catch(() => false) : Promise.resolve(false),
  ]);

  const pricingRule = pricingRows[0];
  if (!pricingRule) {
    throw new Error("Pricing rule default belum tersedia untuk balance monitoring.");
  }

  const balanceRounded = Math.round(balance);
  const reservedBalance = Math.max(0, Number(currentRows[0]?.reserved_balance ?? 0));
  const availableBalance = Math.max(0, balanceRounded - reservedBalance);
  const targetBalance = Number(pricingRule.target_supplier_balance);
  const lowThreshold = Number(pricingRule.low_supplier_balance);
  const criticalThreshold = Number(pricingRule.critical_supplier_balance);
  const status = getStatus(availableBalance, lowThreshold, criticalThreshold);
  const previousStatus = previousSnapshots[0]?.status ?? null;
  const recommendedDeposit = Math.max(0, targetBalance - availableBalance);
  const checkedAt = new Date().toISOString();
  const sandbox = sandboxMode;

  if (currentRows[0]) {
    await supabaseUpdate(
      "supplier_balances",
      {
        balance: balanceRounded,
        reserved_balance: reservedBalance,
        checked_at: checkedAt,
        updated_at: checkedAt,
      },
      { filters: { supplier_id: `eq.${supplierId}` } },
    );
  } else {
    await supabaseInsert("supplier_balances", {
      supplier_id: supplierId,
      balance: balanceRounded,
      reserved_balance: reservedBalance,
      checked_at: checkedAt,
      updated_at: checkedAt,
    });
  }

  await supabaseInsert("supplier_balance_snapshots", {
    supplier_id: supplierId,
    balance: balanceRounded,
    reserved_balance: reservedBalance,
    status,
    source,
    checked_at: checkedAt,
  });

  const statusChanged = previousStatus !== status;

  /*
   * Aturan "kirim atau tidak" semuanya ada di `decideBalanceNotify` -
   * satu fungsi murni yang bisa diuji tanpa database dan tanpa Telegram.
   * Sandbox termasuk di sana: di sandbox saldo selalu 0, jadi tanpa
   * syarat itu cron mengirim "Saldo KRITIS" di setiap berjalan, dan
   * alert yang selalu benar membuat operator mengabaikan semua alert.
   *
   * Snapshot tetap ditulis, jadi `/saldo` tetap menampilkan angka
   * sebenarnya; hanya pesannya yang ditahan.
   */
  const decision = decideBalanceNotify({
    notify,
    sandbox,
    statusChanged,
    previousStatus,
    status,
  });

  let notification:
    | { attempted: false; sent: false; reason: BalanceSkipReason | "not-configured" }
    | { attempted: true; sent: true }
    | { attempted: true; sent: false; reason: "send-failed" };

  if (!decision.send) {
    /*
     * Alasan skipping diteruskan apa adanya, bukan disamarkan jadi
     * "not-needed". Saat sandbox, operator yang melihat "not-needed"
     * akan mengira tidak ada yang perlu diperiksa - padahal sistem
     * sengaja menahannya, dan itu perbedaan yang harus terlihat.
     */
    notification = { attempted: false, sent: false, reason: decision.reason };
  } else if (!isTelegramConfigured()) {
    notification = { attempted: false, sent: false, reason: "not-configured" };
  } else {
    try {
      const result = await sendTelegramMessage(
        buildBalanceAlertMessage({
          supplierLabel: label,
          status,
          previousStatus,
          balance: balanceRounded,
          reservedBalance,
          availableBalance,
          targetBalance,
          recommendedDeposit,
        }),
        {
          kind: "balance",
          /*
           * `supplierId` WAJIB ada di dedupe key. Tanpa itu, Melostore dan
           * Digiflazz yang sama-sama `low -> critical` di jam yang sama
           * saling menimpa: hanya satu alert yang terkirim, dan admin
           * tidak pernah tahu supplier yang satunya sedang kritis.
           */
          dedupeKey: `balance:${supplierId}:${previousStatus ?? "none"}->${status}:${checkedAt.slice(0, 13)}`,
        },
      );
      notification = result.sent
        ? { attempted: true, sent: true }
        : { attempted: false, sent: false, reason: "not-configured" };
    } catch (error) {
      console.error(`Telegram supplier balance alert failed (${supplierId})`, error);
      notification = { attempted: true, sent: false, reason: "send-failed" };
    }
  }

  return {
    supplier: supplierId,
    supplierLabel: label,
    balance: balanceRounded,
    reservedBalance,
    availableBalance,
    status,
    previousStatus,
    statusChanged,
    /*
     * Exposed supaya admin bisa membaca "Saldo 0, KRITIS" dan langsung
     * tahu itu konsekuensi sandbox, bukan uang yang hilang. Tanpa ini,
     * angka 0 di panel terlihat seperti incident.
     */
    sandbox,
    thresholds: {
      target: targetBalance,
      low: lowThreshold,
      critical: criticalThreshold,
    },
    recommendedDeposit,
    checkedAt,
    source,
    notification,
  };
}

/**
 * Cek saldo Digiflazz.
 *
 * Pembungkus yang dipertahankan supaya route lama
 * (`/api/admin/digiflazz/balance`, `/api/cron/digiflazz-balance`) tidak
 * perlu diubah bentuk jawabannya.
 */
export async function checkDigiflazzSupplierBalance(input?: {
  source?: SupplierBalanceCheckSource;
  notify?: boolean;
}) {
  return checkSupplierBalance("digiflazz", input);
}

/**
 * Cek saldo semua supplier yang siap dipakai.
 *
 * Dipakai cron. Supplier yang kredensialnya belum diisi DILEWATI, bukan
 * menggagalkan seluruh pemeriksaan: alert saldo Melostore tidak boleh
 * membuat Digiflazz berhenti dipantau hanya karena satu akun belum
 * diisi.
 */
export async function checkAllSupplierBalances(input?: {
  source?: SupplierBalanceCheckSource;
  notify?: boolean;
}) {
  const ids = usableSupplierIds();

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return { ok: true as const, result: await checkSupplierBalance(id, input) };
      } catch (error) {
        return {
          ok: false as const,
          supplier: id,
          supplierLabel: supplierLabel(id),
          error: error instanceof Error ? error.message : "Cek saldo gagal.",
        };
      }
    }),
  );

  return { checked: results.length, results };
}
