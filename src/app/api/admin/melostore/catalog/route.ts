import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseDelete, supabaseInsert, supabaseSelect, supabaseSelectAll, supabaseUpdate } from "@/lib/supabase/server";
import {
  generateInternalSku,
  internalSkuWithSuffix,
  normalizeProductLabel,
} from "@/lib/internal-sku";
import { gameDariPrefiksSku, isGameEligible } from "@/lib/suppliers/match";
import { riwayatScan } from "@/lib/suppliers/scan-runs";

export const runtime = "nodejs";

/**
 * Browser katalog Melostore + tambah produk internal.
 *
 * GET  -> tabel katalog dengan pencarian, filter, pagination, dan
 *         indikator "sudah ditambahkan ke katalog internal".
 * POST -> "Tambahkan Produk": buat produk internal DRAFT dari satu SKU
 *         Melostore, lengkap dengan pemetaannya.
 *
 * KENAPA FILTER MAPPING DI JS, BUKAN DI SQL
 *
 * Pemetaan hidup di `supplier_products` (supplier_id, supplier_sku),
 * sedangkan katalog di `supplier_catalog_items`. Keduanya tidak punya
 * foreign key satu sama lain, jadi tidak bisa di-join di PostgREST.
 * Filter "sudah/belum ditambahkan" diterapkan di JS setelah kedua
 * himpunan dibaca - dan pagination dihitung SETELAH filter, kalau tidak
 * halaman akan berisi baris yang seharusnya tersaring.
 *
 * Katalog Melostore 9.126 SKU - dibaca penuh di server, tapi yang
 * dikirim ke browser hanya satu halaman (25 baris) plus ringkasan.
 */

type CatalogItemRow = {
  supplier_sku: string;
  product_name: string;
  category: string;
  brand: string;
  type: string;
  supplier_cost: number | string;
  buyer_active: boolean;
  last_seen_at: string;
  inquiry_form_key: string | null;
};

type MappingRow = {
  product_id: string;
  supplier_sku: string | null;
};

type ProductRow = {
  id: string;
  label: string;
  internal_sku: string | null;
  active: boolean;
  selling_price: number | string;
};

function clean(value: string | null) {
  return (value ?? "").trim().slice(0, 160);
}

export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = clean(url.searchParams.get("q")).toLowerCase();
  const kategori = clean(url.searchParams.get("kategori"));
  const brandFilter = clean(url.searchParams.get("brand")); // nama brand asli dari katalog
  const gameFilter = clean(url.searchParams.get("game")); // gameId dari Nambah
  const tersedia = clean(url.searchParams.get("tersedia")); // active | inactive
  const mapping = clean(url.searchParams.get("mapping")); // added | unmapped
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") ?? 25) || 25));

  const [items, mappings, runs] = await Promise.all([
    supabaseSelectAll<CatalogItemRow>("supplier_catalog_items", {
      select:
        "supplier_sku,product_name,category,brand,type,supplier_cost,buyer_active,last_seen_at,inquiry_form_key",
      filters: { supplier_id: "eq.melostore" },
      order: "product_name.asc",
    }),
    supabaseSelectAll<MappingRow>("supplier_products", {
      select: "product_id,supplier_sku",
      filters: { supplier_id: "eq.melostore" },
    }),
    riwayatScan("melostore", 5),
  ]);

  /*
   * Definisi form input pelanggan. Kolom mungkin belum ada sebelum
   * migrasi 046 - dibaca best-effort supaya browser tetap jalan,
   * hanya chip form yang kosong.
   */
  let forms: Record<string, { fields: Array<{ key: string; name: string; type: string }>; notice: string | null }> = {};
  try {
    const formRows = await supabaseSelectAll<{
      form_key: string;
      fields: Array<{ key: string; name: string; type: string }>;
      notice: string | null;
    }>("supplier_inquiry_forms", {
      select: "form_key,fields,notice",
      filters: { supplier_id: "eq.melostore" },
    });
    for (const row of formRows) {
      if (row.form_key && Array.isArray(row.fields)) {
        forms[row.form_key] = { fields: row.fields, notice: row.notice ?? null };
      }
    }
  } catch (error) {
    console.warn(
      "Definisi form Melostore tidak terbaca - jalankan migrasi 046 dan scan ulang.",
      error instanceof Error ? error.message : String(error),
    );
    forms = {};
  }

  const mappedBySku = new Map(mappings.map((m) => [m.supplier_sku ?? "", m.product_id] as const));
  const productIds = [...new Set(mappings.map((m) => m.product_id))];

  /*
   * Produk internal yang sudah terhubung - dibaca sekali untuk semua
   * baris yang terpetakan, bukan per baris. Tanpa itu, tabel 25 baris
   * memicu 25 permintaan produk.
   */
  const produk = new Map<string, ProductRow>();
  for (let i = 0; i < productIds.length; i += 500) {
    const batch = productIds.slice(i, i + 500);
    const idFilter = `in.(${batch.map((id) => `"${id}"`).join(",")})`;
    const rows = await supabaseSelect<ProductRow>("products", {
      select: "id,label,internal_sku,active,selling_price",
      filters: { id: idFilter },
      limit: 500,
    });
    for (const row of rows) produk.set(row.id, row);
  }

  // Game Nambah aktif untuk dropdown filter
  const games = await supabaseSelect<{ id: string; name: string }>("games", {
    select: "id,name",
    filters: { active: "eq.true" },
    order: "name.asc",
    limit: 300,
  });
  const gameById = new Map(games.map((g) => [g.id, g.name]));

  // Bangun informasi game per item + kelompokkan untuk navigasi grup
  type ItemWithGame = CatalogItemRow & { gameId: string; gameName: string; gameConfident: boolean };
  const itemsWithGame: ItemWithGame[] = items.map((item) => {
    const { gameId, confident } = gameDariPrefiksSku(item.supplier_sku);
    const gameName = gameId ? (gameById.get(gameId) ?? gameId) : "Tidak dikenal";
    return { ...item, gameId, gameName, gameConfident: confident };
  });

  /*
   * Kelompokkan: kategori -> BRAND ASLI.
   *
   * Brand dari meta.brands katalog (disimpan scan). Data lama hasil
   * scan sebelum kolom brand diperbaiki berisi brand == kategori;
   * kelompok seperti itu tetap tampil sebagai satu grup - setelah
   * scan ulang, brand asli menggantinya.
   */
  const kategoriUnik = [...new Set(itemsWithGame.map((i) => i.category))].sort((a, b) =>
    a.localeCompare(b, "id"),
  );
  const groups: Record<string, Record<string, { total: number; tersedia: number; ditambahkan: number }>> = {};
  for (const item of itemsWithGame) {
    const kat = item.category;
    const brand = item.brand?.trim() || "Tanpa brand";
    if (!groups[kat]) groups[kat] = {};
    if (!groups[kat][brand]) groups[kat][brand] = { total: 0, tersedia: 0, ditambahkan: 0 };
    groups[kat][brand].total += 1;
    if (item.buyer_active) groups[kat][brand].tersedia += 1;
    if (mappedBySku.has(item.supplier_sku)) groups[kat][brand].ditambahkan += 1;
  }

  const tersaring = itemsWithGame.filter((item) => {
    if (q && !item.product_name.toLowerCase().includes(q) && !item.supplier_sku.toLowerCase().includes(q)) {
      return false;
    }
    if (kategori && item.category !== kategori) return false;
    if (gameFilter && item.gameId !== gameFilter) return false;
    if (brandFilter && (item.brand?.trim() || "Tanpa brand") !== brandFilter) return false;
    if (tersedia === "active" && !item.buyer_active) return false;
    if (tersedia === "inactive" && item.buyer_active) return false;

    const productId = mappedBySku.get(item.supplier_sku);
    if (mapping === "added" && !productId) return false;
    if (mapping === "unmapped" && productId) return false;
    return true;
  });

  const total = tersaring.length;
  const start = (page - 1) * pageSize;
  const halaman = tersaring.slice(start, start + pageSize);

  const rows = halaman.map((item) => {
    const productId = mappedBySku.get(item.supplier_sku) ?? null;
    const internal = productId ? produk.get(productId) ?? null : null;
    const form = item.inquiry_form_key ? forms[item.inquiry_form_key] ?? null : null;

    return {
      sku: item.supplier_sku,
      name: item.product_name,
      category: item.category,
      brand: item.brand?.trim() || null,
      type: item.type,
      cost: Number(item.supplier_cost),
      active: item.buyer_active,
      lastSeenAt: item.last_seen_at,
      added: Boolean(productId),
      gameId: item.gameId,
      gameName: item.gameName,
      gameConfident: item.gameConfident,
      inquiryFormKey: item.inquiry_form_key,
      inquiryFields: form ? form.fields : null,
      inquiryNotice: form ? form.notice : null,
      internalProduct: internal
        ? {
            id: internal.id,
            label: internal.label,
            internalSku: internal.internal_sku,
            active: internal.active,
            sellingPrice: Number(internal.selling_price),
          }
        : null,
    };
  });

  return Response.json({
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    categories: kategoriUnik,
    brands: [...new Set(items.map((i) => i.brand?.trim() ?? "").filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "id"),
    ),
    games,
    groups,
    addedCount: mappings.length,
    scan: {
      lastRun: runs[0]
        ? {
            status: runs[0].status,
            startedAt: runs[0].started_at,
            finishedAt: runs[0].finished_at,
            found: runs[0].found_count,
            baru: runs[0].new_count,
            updated: runs[0].updated_count,
            pagesFailed: runs[0].pages_failed,
            error: runs[0].error,
          }
        : null,
      lastSuccessAt: runs.find((r) => r.status === "success")?.finished_at ?? null,
    },
  });
}

/**
 * Tambahkan produk internal dari satu SKU Melostore.
 *
 * URUTAN YANG MENENTUKAN SEMUANYA
 *
 * Kandidat Digiflazz dievaluasi SEBELUM produk dibuat - bukan sesudah.
 * Versi lama membuat draft dulu, lalu gagal memetakan Digiflazz karena
 * SKU Digiflazz itu ternyata sudah dipetakan ke produk yang SUDAH ADA:
 * constraint `supplier_products_supplier_sku_unique` menolak, dan yang
 * tertinggal adalah draft duplikat plus satu pemetaan tanpa pasangan.
 *
 * Padahal kegagalan itu adalah INFORMASI: SKU Digiflazz yang sudah
 * terpetakan berarti produk internal setara sudah ada. Jadi urutan yang
 * benar adalah cari dulu, pakai kembali bila ketemu, baru buat bila
 * benar-benar tidak ada.
 */

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { sku?: string; gameId?: string; label?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const sku = clean(body.sku ?? null);
  if (!sku) {
    return Response.json({ error: "SKU Melostore wajib diisi." }, { status: 400 });
  }

  // 1. Sudah ditambahkan sebelumnya dari sisi Melostore?
  const existingMappings = await supabaseSelect<MappingRow>(
    "supplier_products",
    {
      select: "product_id,supplier_sku",
      filters: { supplier_id: "eq.melostore", supplier_sku: `eq.${sku}` },
      limit: 1,
    },
  );

  if (existingMappings.length > 0) {
    const productId = existingMappings[0].product_id;
    const produk = await supabaseSelect<ProductRow>("products", {
      select: "id,label,internal_sku,active,selling_price",
      filters: { id: `eq.${productId}` },
      limit: 1,
    });

    return Response.json({
      alreadyAdded: true,
      product: produk[0] ?? null,
      message: "SKU ini sudah ditambahkan sebelumnya - tidak ada yang dibuat ulang.",
    });
  }

  // 2. Data katalog untuk nama, modal, dan validasi.
  const itemRows = await supabaseSelect<CatalogItemRow>("supplier_catalog_items", {
    select:
      "supplier_sku,product_name,category,brand,type,supplier_cost,buyer_active",
    filters: { supplier_id: "eq.melostore", supplier_sku: `eq.${sku}` },
    limit: 1,
  });
  const item = itemRows[0];
  if (!item) {
    return Response.json(
      { error: "SKU tidak ada di katalog Melostore yang ter-cache. Jalankan scan dulu." },
      { status: 404 },
    );
  }

  // 3. Game wajib dipilih - katalog Melostore tidak membawa game Nambah.
  const gameId = clean(body.gameId ?? null);
  if (!gameId) {
    return Response.json(
      { error: "Game wajib dipilih - katalog Melostore tidak menyebut game Nambah." },
      { status: 400 },
    );
  }

  const gameRows = await supabaseSelect<{ id: string; name: string }>("games", {
    select: "id,name",
    filters: { id: `eq.${gameId}`, active: "eq.true" },
    limit: 1,
  });
  const game = gameRows[0];
  if (!game) {
    return Response.json({ error: "Game tidak ditemukan atau tidak aktif." }, { status: 422 });
  }

  const label = clean(body.label ?? null) || item.product_name;

  // 4. Kandidat Digiflazz dievaluasi SEKARANG, sebelum apa pun dibuat.
  const evaluasi = await kandidatDigiflazz(gameId, game.name, label);

  /*
   * Produk setara dari sisi Digiflazz: kandidat yang SKU-nya SUDAH
   * dipetakan ke produk internal.
   *
   * Satu kandidat Digiflazz yang sudah terpetakan berarti barang itu
   * dijual Nambah dengan identitas sendiri - jadi produk internal setara
   * ada, dan yang harus dilakukan hanyalah menambahkan sisi Melostore ke
   * produk yang sama.
   */
  let produkSetaraId: string | null = null;
  if (evaluasi.autoSku) {
    const terpetakan = await supabaseSelect<MappingRow>("supplier_products", {
      select: "product_id,supplier_sku",
      filters: {
        supplier_id: "eq.digiflazz",
        supplier_sku: `eq.${evaluasi.autoSku}`,
      },
      limit: 1,
    });
    produkSetaraId = terpetakan[0]?.product_id ?? null;
  } else if (evaluasi.candidates.length > 0) {
    // Banyak kandidat: cek apakah salah satunya sudah terpetakan.
    for (const kandidat of evaluasi.candidates) {
      const terpetakan = await supabaseSelect<MappingRow>("supplier_products", {
        select: "product_id,supplier_sku",
        filters: {
          supplier_id: "eq.digiflazz",
          supplier_sku: `eq.${kandidat.sku}`,
        },
        limit: 1,
      });
      if (terpetakan.length > 0) {
        produkSetaraId = terpetakan[0].product_id;
        break;
      }
    }
  }

  let productId: string;
  let internalSku: string | null;
  let product: ProductRow | null;
  let dibuatBaru = false;

  if (produkSetaraId) {
    /*
     * Produk internal setara SUDAH ADA. Dipakai kembali - membuat draft
     * kedua untuk barang yang sama berarti dua halaman katalog menjual
     * satu barang yang sama, dan yang satu tidak punya harga.
     */
    productId = produkSetaraId;
    internalSku = await internalSkuForProduct(productId);
    dibuatBaru = false;
    product =
      (await supabaseSelect<ProductRow>("products", {
        select: "id,label,internal_sku,active,selling_price",
        filters: { id: `eq.${productId}` },
        limit: 1,
      }))[0] ?? null;
  } else {
    // 5. SKU internal dari generator, dengan akhiran kalau bentrok.
    const input = { gameId, label, jenis: item.type, supplierSku: sku };

    internalSku = generateInternalSku(input, sku);
    if (!internalSku) {
      return Response.json(
        { error: "SKU internal tidak bisa dibentuk dari label ini." },
        { status: 422 },
      );
    }

    if (await internalSkuDipakai(internalSku)) {
      let dipasang = false;
      for (let suffix = 2; suffix < 50; suffix += 1) {
        const kandidat = internalSkuWithSuffix(input, suffix, sku);
        if (!kandidat) break;
        if (!(await internalSkuDipakai(kandidat))) {
          internalSku = kandidat;
          dipasang = true;
          break;
        }
      }
      if (!dipasang) {
        return Response.json(
          { error: `SKU internal ${internalSku} bentrok dan tidak bisa diberi akhiran.` },
          { status: 409 },
        );
      }
    }

    /*
     * Id produk mengikuti konvensi produk dari supplier: awalan supplier,
     * SKU-nya, lalu akhiran acak. `df-` milik Digiflazz; `ms-` Melostore.
     */
    productId = `ms-${sku.toLowerCase()}-${randomHex(8)}`;

    const inserted = await supabaseInsert<ProductRow>("products", {
      id: productId,
      game_id: gameId,
      label,
      internal_sku: internalSku,
      selling_price: 0,
      reference_price: 0,
      active: false,
      note: `Draft dari katalog Melostore (${sku}).`,
    });

    product = inserted[0] ?? null;
    dibuatBaru = true;
  }

  // 6. Pemetaan Melostore -> produk, dengan metadata manual.
  await supabaseInsert("supplier_products", {
    supplier_id: "melostore",
    product_id: productId,
    supplier_sku: sku,
    supplier_cost: Number(item.supplier_cost),
    active: true,
    last_synced_at: new Date().toISOString(),
    mapped_via: "manual",
    mapped_by: auth.principal.userId,
    mapped_at: new Date().toISOString(),
    mapped_note: dibuatBaru
      ? "Ditambahkan dari katalog Melostore."
      : "Ditambahkan dari katalog Melostore; produk setara sudah ada dan dipakai kembali.",
  });

  // 7. Kandidat Digiflazz yang BELUM terpetakan dipetakan otomatis,
  //    hanya kalau tepat satu dan produk memang baru dibuat.
  let autoMappedSku: string | null = null;
  if (dibuatBaru && evaluasi.autoSku && !produkSetaraId) {
    await supabaseInsert("supplier_products", {
      supplier_id: "digiflazz",
      product_id: productId,
      supplier_sku: evaluasi.autoSku,
      supplier_cost: evaluasi.autoCost,
      active: true,
      last_synced_at: new Date().toISOString(),
      mapped_via: "auto",
      mapped_at: new Date().toISOString(),
    });
    autoMappedSku = evaluasi.autoSku;
  }

  return Response.json({
    ok: true,
    alreadyAdded: false,
    reusedEquivalent: Boolean(produkSetaraId),
    product: {
      id: productId,
      label,
      internalSku,
      active: product?.active ?? false,
      sellingPrice: product ? Number(product.selling_price) : 0,
    },
    digiflazz: {
      autoMappedSku,
      candidates: evaluasi.candidates,
      reason: evaluasi.reason,
    },
    message: dibuatBaru
      ? `Produk draft dibuat: ${label} (${internalSku}).` +
        (autoMappedSku
          ? ` Kandidat Digiflazz ${autoMappedSku} dipetakan otomatis.`
          : " Tidak ada kandidat Digiflazz yang pasti - periksa daftar kandidat.")
      : `Produk setara sudah ada (${internalSku ?? productId}) - sisi Melostore dipetakan ke produk itu, tanpa membuat duplikat.`,
  });
}

/** SKU internal milik sebuah produk, atau null. */
async function internalSkuForProduct(productId: string): Promise<string | null> {
  const rows = await supabaseSelect<{ internal_sku: string | null }>("products", {
    select: "internal_sku",
    filters: { id: `eq.${productId}` },
    limit: 1,
  });
  return rows[0]?.internal_sku ?? null;
}

async function internalSkuDipakai(internalSku: string): Promise<boolean> {
  const rows = await supabaseSelect<{ id: string }>("products", {
    select: "id",
    filters: { internal_sku: `eq.${internalSku}` },
    limit: 1,
  });
  return rows.length > 0;
}

function randomHex(length: number) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

type DigiflazzCatalogRow = {
  supplier_sku: string;
  product_name: string;
  brand: string;
  supplier_cost: number | string;
  buyer_active: boolean;
};

/**
 * Kandidat setara dari Digiflazz untuk satu produk internal.
 *
 * Pencocokan: nama dinormalisasi SAMA persis, dan brand Digiflazz harus
 * cocok dengan nama game. Nominal tidak diperiksa terpisah karena sudah
 * tercakup oleh nama ("50 Diamonds" vs "56 Diamonds" tidak pernah sama).
 *
 * Auto-map hanya kalau TEPAT SATU kandidat. Dua SKU Digiflazz untuk nama
 * yang sama berarti ambigu - memilih yang termurah terlihat optimizes,
 * tapi belum tentu varian yang dimaksud.
 */
async function kandidatDigiflazz(
  gameId: string,
  gameName: string,
  label: string,
): Promise<{
  autoSku: string | null;
  autoCost: number | null;
  reason: "exact-single" | "multiple" | "none";
  candidates: Array<{ sku: string; name: string; cost: number }>;
}> {
  const target = normalizeProductLabel(label);
  const brandTarget = normalizeProductLabel(gameName);

  const rows = await supabaseSelectAll<DigiflazzCatalogRow>(
    "supplier_catalog_items",
    {
      select: "supplier_sku,product_name,brand,supplier_cost,buyer_active",
      filters: { supplier_id: "eq.digiflazz", buyer_active: "eq.true" },
    },
  );

  /*
   * Brand dicocokkan pada kandidat nama-sama, bukan sebagai penyaring
   * awal. Menyaring brand lebih dulu berarti nama yang cocok di brand
   * lain tak terlihat - dan operator tidak diberi tahu bahwa ada
   * kandidat yang namanya sama tapi milik game berbeda.
   */
  const cocok = rows
    .filter((row) => normalizeProductLabel(row.product_name) === target)
    .map((row) => ({
      row,
      brandCocok: normalizeProductLabel(row.brand) === brandTarget,
    }));

  const terverifikasi = cocok.filter((c) => c.brandCocok);

  if (cocok.length === 0) {
    return { autoSku: null, autoCost: null, reason: "none", candidates: [] };
  }

  const kandidatSemua = cocok
    .map((c) => ({
      sku: c.row.supplier_sku,
      name: c.row.product_name,
      cost: Number(c.row.supplier_cost),
      brandCocok: c.brandCocok,
    }))
    .sort((a, b) => a.cost - b.cost);

  if (terverifikasi.length !== 1) {
    return {
      autoSku: null,
      autoCost: null,
      reason: terverifikasi.length === 0 ? "none" : "multiple",
      candidates: kandidatSemua.slice(0, 8),
    };
  }

  return {
    autoSku: terverifikasi[0].row.supplier_sku,
    autoCost: Number(terverifikasi[0].row.supplier_cost),
    reason: "exact-single",
    candidates: kandidatSemua.slice(0, 8),
  };
}
