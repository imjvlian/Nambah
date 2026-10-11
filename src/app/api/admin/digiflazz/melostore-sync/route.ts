import { authorizeAdminRequest } from "@/lib/admin-api";
import { MelostoreSupplierClient } from "@/lib/suppliers/melostore-client";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Sinkronisasi katalog Melostore dan pembaruan saldo.
 *
 * POST body: `{ action: "balance" | "catalog" | "cache-catalog" }`
 *
 * "balance" membaca `/profile/balance` dan menulis ke `supplier_balances`.
 * Aman dipanggil berkala - hanya membaca dan menulis satu baris.
 *
 * "catalog" menarik seluruh katalog, lalu memperbarui `supplier_cost`
 * untuk pemetaan yang SUDAH ADA. Product yang belum dipetakan tidak
 * disentuh: sync harga tidak punya hak memutuskan pemetaan.
 *
 * Kenapa dipisah dari `melostore-mapping`
 *
 * Route pemetaan bekerja di browser dan menampilkan kandidat untuk
 * manusia. Ini bekerja diam-diam dan hanya menyentuh baris yang sudah
 * dipetakan. Menggabungkannya akan membuat satu tombol punya dua
 * perilaku berbeda - dan tombol "sinkron" yang diam-diam memasang
 * ratusan pemetaan adalah cara memastikan tidak ada yang akan dipencet.
 */

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const client = new MelostoreSupplierClient();
  if (!client.isConfigured()) {
    return Response.json(
      { error: "Kredensial Melostore belum diisi." },
      { status: 503 },
    );
  }

  let body: { action?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  if (body.action === "balance") return syncBalance(client);
  if (body.action === "catalog") return syncCatalogCosts(client);
  if (body.action === "cache-catalog") return cacheMelostoreCatalog(client);

  return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
}

async function syncBalance(client: MelostoreSupplierClient) {
  let profile;
  try {
    profile = await client.fetchProfile();
  } catch (error) {
    return Response.json(
      {
        error:
          "Gagal membaca saldo: " +
          (error instanceof Error ? error.message : "tidak diketahui"),
      },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();

  /*
   * `reserved_balance` TIDAK ditulis.
   *
   * Saldo yang sedang dikunci order lain bukan milik sinkronisasi.
   * Menyalin `balance` sambil menyiapkan `reserved_balance` ke nol akan
   * membuat selection melihat supplier bisa dipakai lagi, sementara
   * order yang sudah berjalan masih menyimpan uangnya.
   */
  const existing = await supabaseSelect<{ supplier_id: string }>(
    "supplier_balances",
    { select: "supplier_id", filters: { supplier_id: "eq.melostore" }, limit: 1 },
  );

  if (existing.length > 0) {
    await supabaseUpdate(
      "supplier_balances",
      { balance: profile.balance, checked_at: now, updated_at: now },
      { filters: { supplier_id: "eq.melostore" } },
    );
  } else {
    await supabaseInsert("supplier_balances", {
      supplier_id: "melostore",
      balance: profile.balance,
      reserved_balance: 0,
      checked_at: now,
    });
  }

  return Response.json({
    ok: true,
    balance: profile.balance,
    sandbox: profile.sandbox,
    tier: profile.tierName,
    webhookUrl: profile.webhookUrl,
  });
}

async function syncCatalogCosts(client: MelostoreSupplierClient) {
  const existing = await supabaseSelect<{
    product_id: string;
    supplier_sku: string | null;
    supplier_cost: number | string;
  }>("supplier_products", {
    select: "product_id,supplier_sku,supplier_cost",
    filters: { supplier_id: "eq.melostore" },
    limit: 2000,
  });

  if (existing.length === 0) {
    return Response.json(
      {
        error:
          "Belum ada pemetaan Melostore. Jalankan \"pasang otomatis\" atau " +
          "petakan manual dulu - sinkron harga hanya memperbarui yang sudah dipetakan.",
      },
      { status: 409 },
    );
  }

  let quotes;
  try {
    quotes = await client.fetchQuotes();
  } catch (error) {
    return Response.json(
      {
        error:
          "Gagal menarik katalog: " +
          (error instanceof Error ? error.message : "tidak diketahui"),
      },
      { status: 502 },
    );
  }

  const priceBySku = new Map(quotes.map((q) => [q.sku, q.cost] as const));
  const now = new Date().toISOString();

  let updated = 0;
  let unchanged = 0;
  const missing: string[] = [];

  for (const row of existing) {
    const sku = row.supplier_sku?.trim();
    if (!sku) continue;

    const next = priceBySku.get(sku);
    if (next === undefined) {
      // SKU hilang dari katalog. Baris dibiarkan apa adanya - menghapusnya
      // akan membuat order yang sedang berjalan kehilangan rujukan.
      missing.push(sku);
      continue;
    }

    if (Number(row.supplier_cost) === next) {
      unchanged += 1;
      continue;
    }

    await supabaseUpdate(
      "supplier_products",
      { supplier_cost: next, last_synced_at: now },
      { filters: { supplier_id: "eq.melostore", product_id: `eq.${row.product_id}` } },
    );
    updated += 1;
  }

  return Response.json({
    ok: true,
    scanned: existing.length,
    updated,
    unchanged,
    missingFromCatalog: missing.length,
    sampleMissing: missing.slice(0, 5),
    message:
      `${updated} harga diperbarui, ${unchanged} tidak berubah` +
      (missing.length > 0 ? `, ${missing.length} SKU tidak ada di katalog.` : "."),
  });
}

/**
 * Simpan katalog Melostore ke `supplier_catalog_items`.
 *
 * KENAPA DI-CACHE, BUKAN DITARIK PERMINTAAN DROPDOWN
 *
 * Katalog Melostore berisi 10.000 SKU dan batas tarif katalognya 20
 * permintaan/menit - dibagi bersama endpoint kategori. Kalau setiap
 * dropdown menarik katalog langsung dari API, dua admin yang membuka
 * form produk bersamaan sudah menghabiskan jatahnya.
 *
 * Tabelnya SUDAH ADA dan generik: primary key-nya (supplier_id,
 * supplier_sku), jadi baris Digiflazz dan Melostore hidup berdampingan
 * tanpa tabel baru.
 *
 * KOLOM DIGIFLAZZ YANG TIDAK MILIK MELOSTORE
 *
 * Beberapa kolom not null dibentuk dari data Digiflazz. Melostore tidak
 * mengirim stok sama sekali, jadi unlimited_stock=true dan stock=null -
 * itulah yang benar, bukan data yang hilang. seller_name diisi tetap
 * supaya baris tidak pernah ambigu milik siapa.
 */
async function cacheMelostoreCatalog(client: MelostoreSupplierClient) {
  const katalog = await client.fetchCatalog();
  if (katalog.length === 0) {
    return Response.json(
      { error: "Katalog Melostore kosong - tidak ada yang disimpan." },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();

  /*
   * Upsert per batch. Satu permintaan berisi 10.000 baris akan melewati
   * batas ukuran body PostgREST, dan kegagalannya hanya terlihat setelah
   * seluruh tarikan selesai.
   */
  const UKURAN_BATCH = 500;
  let tersimpan = 0;
  for (let i = 0; i < katalog.length; i += UKURAN_BATCH) {
    const batch = katalog.slice(i, i + UKURAN_BATCH).map((item) => ({
      supplier_id: "melostore",
      supplier_sku: item.sku,
      product_name: item.name || item.sku,
      category: item.categoryName ?? "Melostore",
      brand: item.categoryName ?? "Melostore",
      type: "Melostore",
      seller_name: "Melostore H2H",
      supplier_cost: item.price,
      buyer_active: item.status === "active",
      seller_active: true,
      unlimited_stock: true,
      stock: null,
      multi: false,
      start_cut_off: null,
      end_cut_off: null,
      description: null,
      last_seen_at: now,
    }));

    await supabaseUpsert("supplier_catalog_items", batch, {
      onConflict: "supplier_id,supplier_sku",
    });
    tersimpan += batch.length;
  }

  /*
   * SKU yang hilang dari katalog terbaru ditandai tidak aktif.
   *
   * Menghapusnya akan merusak baris mapping yang menunjuk ke SKU itu -
   * dan order yang sedang berjalan masih memakainya. Menandai buyer_active
   * false membuat dropdown tidak lagi menawarkannya, tanpa menghapus
   * rekam jejaknya.
   */
  const skuTersimpan = new Set(katalog.map((item) => item.sku));
  const lama = await supabaseSelect<{ supplier_sku: string }>(
    "supplier_catalog_items",
    {
      select: "supplier_sku",
      filters: { supplier_id: "eq.melostore" },
      limit: 20000,
    },
  );
  let ditandai = 0;
  for (const baris of lama) {
    if (skuTersimpan.has(baris.supplier_sku)) continue;
    await supabaseUpdate(
      "supplier_catalog_items",
      { buyer_active: false, last_seen_at: now },
      {
        filters: {
          supplier_id: "eq.melostore",
          supplier_sku: `eq.${baris.supplier_sku}`,
        },
      },
    );
    ditandai += 1;
  }

  return Response.json({
    ok: true,
    cached: tersimpan,
    inactive: ditandai,
    message:
      `${tersimpan} SKU tersimpan, ${ditandai} tidak ada lagi di katalog dan ditandai nonaktif.`,
  });
}