import {
  getDigiflazzPrepaidPriceList,
  isDigiflazzConfigured,
} from "@/lib/digiflazz/client";
import {
  MelostoreSupplierClient,
  isMelostoreConfigured,
} from "@/lib/suppliers/melostore-client";
import { classifyCostUpdate } from "@/lib/cost-update-guard";
import {
  enqueueTelegramMessage,
  escapeTelegramHtml,
  isTelegramConfigured,
} from "@/lib/telegram";
import { supabaseSelectAll, supabaseUpdate } from "@/lib/supabase/server";

/**
 * Auto-sync HARGA MODAL supplier (cron /api/cron/supplier-price-sync).
 *
 * Latar: order NBH-20261017-5F860649E9 (17 Okt 2026) - WDP ditolak
 * Melostore dengan MAX_PRICE_TOO_LOW karena supplier_cost yang dibekukan
 * saat checkout (62.415) sudah basi terhadap harga hidup (63.172). Harga
 * H2H bergerak harian; tanpa sinkron rutin, kelas kegagalan ini terulang
 * terus.
 *
 * Scope sengaja sempit - HANYA supplier_products.supplier_cost:
 * - TIDAK menyentuh harga jual produk: mengubahnya otomatis adalah
 *   keputusan bisnis; tombol "sinkron harga" admin (yang punya logika
 *   minimumSellingPrice) tetap pemilik jalur itu.
 * - TIDAK menyentuh flag active mapping: dikelola jalur katalog.
 *
 * Pagar: delta >±10% DITAHAN (tidak diterapkan) dan dilaporkan ke
 * Telegram untuk review manual - satu anomali data supplier tidak boleh
 * tersinkron buta ke seluruh katalog.
 *
 * Notifikasi (permintaan owner 17 Okt): setiap run yang mengubah harga
 * atau menahan sesuatu mengirim ringkasan Telegram.
 */

export type SupplierCostSyncEntry = {
  supplierId: "digiflazz" | "melostore";
  scanned: number;
  updated: number;
  unchanged: number;
  held: number;
  missingFromCatalog: number;
  heldSamples: Array<{ sku: string; from: number; to: number }>;
  skippedReason: string | null;
  error: string | null;
};

export type SupplierPriceSyncReport = {
  entries: SupplierCostSyncEntry[];
  notified: boolean;
};

type SupplierProductMappingRow = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
};

function emptyEntry(supplierId: "digiflazz" | "melostore"): SupplierCostSyncEntry {
  return {
    supplierId,
    scanned: 0,
    updated: 0,
    unchanged: 0,
    held: 0,
    missingFromCatalog: 0,
    heldSamples: [],
    skippedReason: null,
    error: null,
  };
}

function supplierLabel(supplierId: string) {
  return supplierId === "melostore" ? "Melostore" : "Digiflazz";
}

async function loadMappings(
  supplierId: "digiflazz" | "melostore",
): Promise<SupplierProductMappingRow[]> {
  return supabaseSelectAll<SupplierProductMappingRow>("supplier_products", {
    select: "product_id,supplier_sku,supplier_cost",
    filters: { supplier_id: `eq.${supplierId}` },
  });
}

async function syncCostsForSupplier(
  supplierId: "digiflazz" | "melostore",
  priceBySku: Map<string, number>,
): Promise<SupplierCostSyncEntry> {
  const entry = emptyEntry(supplierId);
  const mappings = await loadMappings(supplierId);
  const now = new Date().toISOString();
  const updates: Array<{ productId: string; cost: number }> = [];

  for (const row of mappings) {
    const sku = row.supplier_sku?.trim();
    if (!sku) continue;
    entry.scanned += 1;

    const next = priceBySku.get(sku);
    if (next === undefined) {
      // SKU hilang dari katalog supplier. Baris dibiarkan apa adanya -
      // order yang sedang berjalan masih memakainya sebagai rujukan.
      entry.missingFromCatalog += 1;
      continue;
    }

    const decision = classifyCostUpdate(Number(row.supplier_cost), next);
    if (decision === "unchanged") {
      entry.unchanged += 1;
      continue;
    }
    if (decision === "hold") {
      entry.held += 1;
      if (entry.heldSamples.length < 8) {
        entry.heldSamples.push({
          sku,
          from: Number(row.supplier_cost),
          to: next,
        });
      }
      continue;
    }

    updates.push({ productId: row.product_id, cost: next });
    entry.updated += 1;
  }

  for (const update of updates) {
    await supabaseUpdate(
      "supplier_products",
      {
        supplier_cost: update.cost,
        last_synced_at: now,
        updated_at: now,
      },
      {
        filters: {
          supplier_id: `eq.${supplierId}`,
          product_id: `eq.${update.productId}`,
        },
      },
    );
  }

  return entry;
}

async function digiflazzPrices(): Promise<Map<string, number>> {
  const items = (await getDigiflazzPrepaidPriceList()) as unknown as Array<
    Record<string, unknown>
  >;
  const prices = new Map<string, number>();
  for (const item of items) {
    const sku =
      typeof item.buyer_sku_code === "string" ? item.buyer_sku_code.trim() : "";
    const price = Number(item.price);
    if (sku && Number.isFinite(price) && price >= 0) {
      prices.set(sku, Math.round(price));
    }
  }
  return prices;
}

async function melostorePrices(
  client: MelostoreSupplierClient,
): Promise<Map<string, number>> {
  const quotes = await client.fetchQuotes();
  const prices = new Map<string, number>();
  for (const quote of quotes) {
    const cost = Number(quote.cost);
    if (quote.sku && Number.isFinite(cost) && cost >= 0) {
      prices.set(quote.sku, Math.round(cost));
    }
  }
  return prices;
}

async function maybeNotifyPriceSync(
  entries: SupplierCostSyncEntry[],
): Promise<boolean> {
  const anyChange = entries.some(
    (entry) => entry.updated > 0 || entry.held > 0 || entry.error !== null,
  );
  if (!anyChange || !isTelegramConfigured()) return false;

  const lines = ["<b>Sinkron harga supplier</b>"];
  for (const entry of entries) {
    if (entry.error) {
      lines.push(
        `${supplierLabel(entry.supplierId)}: gagal - ${escapeTelegramHtml(entry.error)}`,
      );
      continue;
    }
    if (entry.skippedReason) {
      lines.push(
        `${supplierLabel(entry.supplierId)}: dilewati (${escapeTelegramHtml(entry.skippedReason)})`,
      );
      continue;
    }
    const parts = [
      `${entry.updated} harga berubah`,
      `${entry.unchanged} tetap`,
    ];
    if (entry.held > 0) parts.push(`${entry.held} DITAHAN guard >±10%`);
    if (entry.missingFromCatalog > 0) {
      parts.push(`${entry.missingFromCatalog} tidak ada di katalog`);
    }
    lines.push(`${supplierLabel(entry.supplierId)}: ${parts.join(", ")}`);
  }

  const heldLines = entries.flatMap((entry) =>
    entry.heldSamples.map(
      (sample) =>
        `• ${escapeTelegramHtml(sample.sku)}: ${sample.from} → ${sample.to} ` +
        `(${Math.round(((sample.to - sample.from) / Math.max(sample.from, 1)) * 100)}%)`,
    ),
  );
  if (heldLines.length > 0) {
    lines.push("");
    lines.push("Ditahan - perlu review manual (jalankan sinkron harga admin):");
    lines.push(...heldLines.slice(0, 10));
  }

  await enqueueTelegramMessage(lines.join("\n"), {
    kind: "ops",
    // Dedupe per jam: job berjalan tiap jam, dan rerun manual dalam jam
    // yang sama tidak boleh mengirim dua pesan.
    dedupeKey: `price-sync:${Math.floor(Date.now() / 3_600_000)}`,
    payload: {
      summary: entries.map((entry) => ({
        supplierId: entry.supplierId,
        updated: entry.updated,
        held: entry.held,
      })),
    },
  });
  return true;
}

export async function syncSupplierPrices(): Promise<SupplierPriceSyncReport> {
  const entries: SupplierCostSyncEntry[] = [];

  let digiflazzEntry = emptyEntry("digiflazz");
  try {
    if (!isDigiflazzConfigured()) {
      digiflazzEntry.skippedReason = "kredensial Digiflazz belum diisi";
    } else {
      digiflazzEntry = await syncCostsForSupplier(
        "digiflazz",
        await digiflazzPrices(),
      );
    }
  } catch (error) {
    digiflazzEntry.error =
      error instanceof Error ? error.message : "tidak diketahui";
  }
  entries.push(digiflazzEntry);

  let melostoreEntry = emptyEntry("melostore");
  try {
    if (!isMelostoreConfigured()) {
      melostoreEntry.skippedReason = "kredensial Melostore belum diisi";
    } else {
      melostoreEntry = await syncCostsForSupplier(
        "melostore",
        await melostorePrices(new MelostoreSupplierClient()),
      );
    }
  } catch (error) {
    melostoreEntry.error =
      error instanceof Error ? error.message : "tidak diketahui";
  }
  entries.push(melostoreEntry);

  const notified = await maybeNotifyPriceSync(entries);
  return { entries, notified };
}
