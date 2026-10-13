import { supabaseInsert, supabaseSelectAll } from "@/lib/supabase/server";
import { gameDariPrefiksSku } from "@/lib/suppliers/match";
import { generateInternalSku } from "@/lib/internal-sku";
import { cariGameCocok } from "@/lib/game-defaults";

/**
 * Merge pasangan Melostore-ke-produk lewat jalur SKU internal.
 *
 * Dipanggil dari DUA tempat yang harus menghasilkan hal yang sama:
 * tombol "Gabungkan via SKU internal" di panel pemetaan (manual), dan
 * auto-merge setelah scan katalog sukses penuh. Sebelum fungsi ini ada,
 * badannya hidup di route pemetaan - memindahkannya ke lib bukan kosmetik:
 * tanpa itu, scan otomatis tidak bisa memanggil merge tanpa salin-tempel.
 *
 * IDENTITAS GAME-JENIS-NOMINAL sama persis - "game sama dan nominal sama"
 * terjamin by construction; tebakan label tidak pernah dipakai.
 */

export type MergeInternalSkuSummary = {
  terpasang: number;
  dilewati: {
    sudahAda: number;
    identitasTidakDikenal: number;
    ambigu: number;
    bundel: number;
    takAdaProduk: number;
  };
  totalDiproses: number;
  message: string;
  errors?: string[];
};

export async function mergeMelostoreViaInternalSku(
  mappedBy: string | null,
): Promise<MergeInternalSkuSummary> {
  /*
   * Katalog Melostore 8.000+ baris - melebihi batas satu respons PostgREST.
   * `supabaseSelect` dengan limit besar tetap terpotong di 1.000 baris
   * (terbukti di uji nyata: hanya 1.000 dari 8.138 SKU yang diproses),
   * jadi pemakaian yang benar adalah `supabaseSelectAll` yang membagi
   * halaman otomatis.
   *
   * `brand` ikut dibaca: identitas game untuk SKU yang prefiksnya tidak
   * dikenal (mis. "rgc..." -> "Roblox (IDR)" -> game roblox-idr).
   */
  const meloItems = await supabaseSelectAll<{
    supplier_sku: string;
    product_name: string;
    supplier_cost: number | string;
    buyer_active: boolean;
    brand: string | null;
  }>("supplier_catalog_items", {
    select: "supplier_sku,product_name,supplier_cost,buyer_active,brand",
    filters: { supplier_id: "eq.melostore", buyer_active: "eq.true" },
  });

  if (meloItems.length === 0) {
    throw new Error("Katalog Melostore kosong. Jalankan scan katalog dulu.");
  }

  const existingMappings = await supabaseSelectAll<{ product_id: string; supplier_sku: string }>(
    "supplier_products",
    { select: "product_id,supplier_sku", filters: { supplier_id: "eq.melostore" } },
  );
  const mappedProductIds = new Set(existingMappings.map((m) => m.product_id));
  const mappedSupplierSkus = new Set(existingMappings.map((m) => m.supplier_sku).filter(Boolean));

  const productsWithInternalSku = await supabaseSelectAll<{ id: string; internal_sku: string }>(
    "products",
    { select: "id,internal_sku", filters: { internal_sku: "not.is.null" } },
  );
  const internalSkuToProduct = new Map<string, string>();
  for (const p of productsWithInternalSku) {
    if (p.internal_sku) internalSkuToProduct.set(p.internal_sku, p.id);
  }

  /*
   * Daftar game untuk derivasi identitas dari brand. Semua game dibaca
   * (bukan hanya yang aktif): produk draft di game nonaktif tetap sah
   * digabung - pasangannya baru terlihat begitu game diaktifkan.
   */
  const semuaGame = await supabaseSelectAll<{
    id: string;
    name: string;
    short_name: string;
  }>("games", {
    select: "id,name,short_name",
  });

  const now = new Date().toISOString();
  let terpasang = 0;
  let dilewatiSudahAda = 0;
  let dilewatiIdentitasTidakDikenal = 0;
  let dilewatiAmbigu = 0;
  let dilewatiBundel = 0;
  let dilewatiTakAdaProduk = 0;
  const errors: string[] = [];

  /*
   * TERMURAH DULU: kalau beberapa SKU Melostore menurunkan SKU internal
   * yang sama (mlid50d-s1 dan mlid50d-s5, misalnya), yang dipasang adalah
   * yang termurah - bukan yang kebetulan datang lebih dulu dari database.
   * Melostore adalah supplier pembanding; memasang yang mahal berarti
   * checkout tidak pernah memilihnya.
   */
  const berurut = [...meloItems].sort(
    (a, b) => Number(a.supplier_cost) - Number(b.supplier_cost),
  );

  for (const item of berurut) {
    const sku = item.supplier_sku;
    if (!sku || mappedSupplierSkus.has(sku)) {
      if (mappedSupplierSkus.has(sku)) dilewatiSudahAda += 1;
      continue;
    }

    /*
     * IDENTITAS GAME: prefiks dulu, brand sebagai cadangan.
     *
     * Prefiks lebih kuat (region-aware, tanpa tebakan nama). Brand
     * dipakai hanya kalau prefiks tidak dikenal - SKU "rgc..." tidak
     * punya prefiks dikenal, tapi brand-nya "Roblox (IDR)" cocok dengan
     * game roblox-idr lewat slug/nama/short_name (cariGameCocok).
     */
    let { gameId, confident } = gameDariPrefiksSku(sku);
    if (!gameId && item.brand?.trim()) {
      const cocok = cariGameCocok(item.brand.trim(), semuaGame);
      if (cocok) {
        gameId = cocok.id;
        confident = true;
      }
    }
    if (!gameId) {
      dilewatiIdentitasTidakDikenal += 1;
      continue;
    }
    if (!confident) {
      dilewatiAmbigu += 1;
      continue;
    }

    /*
     * BUNDEL / FIRST TOP UP tidak dipetakan otomatis.
     *
     * "First Top Up 50+Bonus Diamonds" menurunkan SKU internal yang sama
     * dengan "50 Diamond" biasa - nominal terbesar pada labelnya 50 -
     * padahal keduanya barang yang berbeda. Operator tetap bisa
     * memetakan FTU manual lewat panel pemetaan.
     */
    if (/(first\s+(top\s*up|recharge)|ftu|bonus)/i.test(item.product_name ?? "")) {
      dilewatiBundel += 1;
      continue;
    }

    const internalInput = {
      gameId,
      label: item.product_name,
      supplierSku: sku,
    };
    const internalSku = generateInternalSku(internalInput);
    if (!internalSku) {
      dilewatiTakAdaProduk += 1;
      continue;
    }

    const productId = internalSkuToProduct.get(internalSku);
    if (!productId) {
      dilewatiTakAdaProduk += 1;
      continue;
    }

    if (mappedProductIds.has(productId)) {
      dilewatiSudahAda += 1;
      continue;
    }

    try {
      await supabaseInsert("supplier_products", {
        supplier_id: "melostore",
        product_id: productId,
        supplier_sku: sku,
        supplier_cost: Number(item.supplier_cost),
        active: true,
        last_synced_at: now,
        mapped_via: "internal-sku",
        mapped_by: mappedBy,
        mapped_at: now,
      });
      mappedProductIds.add(productId);
      mappedSupplierSkus.add(sku);
      terpasang += 1;
    } catch (error) {
      const pesan = error instanceof Error ? error.message : "galat tidak diketahui";
      errors.push(`${sku} -> ${internalSku}: ${pesan}`);
    }
  }

  return {
    terpasang,
    dilewati: {
      sudahAda: dilewatiSudahAda,
      identitasTidakDikenal: dilewatiIdentitasTidakDikenal,
      ambigu: dilewatiAmbigu,
      bundel: dilewatiBundel,
      takAdaProduk: dilewatiTakAdaProduk,
    },
    totalDiproses: meloItems.length,
    message:
      `${terpasang} pemetaan dipasang. ` +
      `Dilewati: ${dilewatiSudahAda} sudah terpetakan, ${dilewatiIdentitasTidakDikenal} identitas game tidak dikenal, ${dilewatiAmbigu} ambigu FF/FFMAX, ` +
      `${dilewatiBundel} bundel/FTU (petakan manual bila dijual), ` +
      `${dilewatiTakAdaProduk} tidak ada produk dengan SKU internal cocok.`,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };
}
