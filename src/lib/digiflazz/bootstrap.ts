import { syncCatalogWithSupplier } from "@/lib/digiflazz/catalog-sync";

/**
 * Scan / Auto-map lama digantikan oleh rekonsiliasi katalog deterministik.
 *
 * Versi lama menebak SKU dengan pencocokan skor label, dan itu sempat
 * tertukar varian (Free FireMax vs Free Fire). Sekarang mapping selalu mengikuti
 * supplier_sku dan hasilnya identik dengan tombol "Sinkron ke Digiflazz".
 *
 * Bentuk respons sengaja dipertahankan supaya UI admin tidak berubah.
 */

export type BootstrapSummaryShape = {
  supplierCatalogItems: number;
  nambahProducts: number;
  alreadyMapped: number;
  suggested: number;
  autoMapped: number;
  unmapped: number;
  unmappedGameNotFound: number;
  unmappedGameInactive: number;
  unmappedLowScore: number;
  unmappedNoCandidate: number;
  upsertBatches: number;
  upsertFailures: string[];
};

export async function bootstrapDigiflazzCatalog(input?: {
  apply?: boolean;
  remap?: boolean;
}) {
  const apply = input?.apply === true;

  // remap sudah tidak relevan: mapping selalu mengikuti supplier_sku.
  void input?.remap;

  const summary = await syncCatalogWithSupplier({
    dryRun: !apply,
    // Mode apply memakai cache agar tidak kena rate limit Digiflazz.
    preferLive: !apply,
  });

  const total = summary.catalogItems;

  return {
    mode: apply ? ("applied" as const) : ("dry-run" as const),
    source: apply ? ("supplier_catalog_cache" as const) : ("digiflazz_live" as const),
    remap: false,
    syncedAt: apply ? new Date().toISOString() : null,
    catalogScanAt: summary.catalogScanAt,
    staleWarning: summary.staleWarning,
    summary: {
      supplierCatalogItems: summary.catalogItems,
      nambahProducts: summary.expectedActiveMappings,
      alreadyMapped: total - summary.productsCreated - summary.productsRemoved,
      // Tidak ada lagi "suggested": pencocokan skor sudah dihapus.
      suggested: 0,
      autoMapped: apply ? summary.productsCreated : 0,
      unmapped: summary.productsRemoved + summary.productsHidden,
      unmappedGameNotFound: 0,
      unmappedGameInactive: 0,
      unmappedLowScore: 0,
      unmappedNoCandidate: summary.productsCreated,
      upsertBatches: apply ? Math.ceil(summary.productsCreated / 400) : 0,
      upsertFailures: summary.failures,
    },
    mirror: summary,
  };
}