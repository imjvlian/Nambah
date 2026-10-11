import { authorizeAdminRequest } from "@/lib/admin-api";
import { MelostoreSupplierClient } from "@/lib/suppliers/melostore-client";
import {
  supabaseDelete,
  supabaseInsert,
  supabaseSelectAll,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";
import type { MatchableProduct } from "@/lib/suppliers/match";
import {
  generateInternalSku,
  internalSkuWithSuffix,
} from "@/lib/internal-sku";

export const runtime = "nodejs";

/**
 * Pemetaan SKU Melostore ke produk Nambah.
 *
 * GET  -> daftar produk + hasil pencocokan + SKU kandidat, untuk tabel UI.
 * POST -> `{ action: "apply", productId, sku }` untuk menyimpan satu pasangan
 *         secara manual, atau `{ action: "apply-auto" }` untuk memasang semua
 *         pasangan yang pencocokan sudah deems pasti.
 *
 * Kenapa satu route untuk dua aksi: keduanya menulis ke tabel yang sama
 * dengan bentuk yang sama, dan pemanggilnya (UI) selalu butuh keduanya
 * bersamaan. Dua route akan berarti dua tempat untuk authorisation.
 *
 * HASIL PENCOCOKAN DIKIRIM UTUH, BUKAN RINGKAS
 *
 * UI menampilkan kandidat beserta alasannya supaya operator bisa memutuskan,
 * bukan melihat daftar hitam "gagal". Kalau rinciannya disampaikan sebagai
 * "tidak ada", operator akan mulai mengetik SKU yang sama berulang-ulang
 * tanpa pernah tahu kenapa yang otomatis tidak menyala.
 */

type ProductRow = {
  id: string;
  label: string;
  game_id: string;
  active: boolean;
};

type GameRow = {
  id: string;
  name: string;
};

type ExistingMapping = {
  product_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
};

type GameOptions = {
  id: string;
  name: string;
  meloPrefixes: string[];
};

/**
 * Katalog Melostore dari cache database.
 *
 * Semua jalur di route ini - daftar kandidat, verifikasi pemetaan
 * manual, dan pemasangan otomatis - memakai sumber yang sama supaya
 * jawabannya tidak berbeda antar tombol. Menarik langsung dari API di
 * salah satunya berarti tiga tempat dengan tarif 20 permintaan/menit.
 */
async function bacaKatalogMelostore(): Promise<
  Array<{ sku: string; name: string; price: number }>
> {
  const cache = await supabaseSelectAll<{
    supplier_sku: string;
    product_name: string;
    supplier_cost: number | string;
  }>("supplier_catalog_items", {
    select: "supplier_sku,product_name,supplier_cost",
    filters: { supplier_id: "eq.melostore", buyer_active: "eq.true" },
    order: "product_name.asc",
  });

  return cache.map((baris) => ({
    sku: baris.supplier_sku,
    name: baris.product_name,
    price: Number(baris.supplier_cost),
  }));
}
export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const gameFilter = (url.searchParams.get("game") ?? "").trim();
  const onlyUnmapped = url.searchParams.get("unmapped") === "1";

  /*
   * Melempar katalog lengkap (10.000 SKU) ke browser adalah kesalahan.
   * Katalog hanya dipakai DI SERVER untuk pencocokan; yang dikirim ke UI
   * adalah max 5 kandidat per produk. Kandidat pun diambil dari katalog
   * yang sudah tersaring label - bukan pencarian bebas, jadi tidak ada
   * biaya yang tumbuh bersama ukuran katalog.
   */
  /*
   * Kandidat diambil dari `supplier_catalog_items`, BUKAN dari API.
   *
   * Katalog Melostore berisi 10.000 SKU dan tarif tarifnya 20
   * permintaan/menit - dibagi bersama endpoint kategori. Setiap kali
   * operator membuka form produk, menarik katalog langsung akan
   * menghabiskan jatah itu dan membuat dropdown selalu gagal di jam
   * sibuk.
   *
   * Katalog di-cache oleh aksi "cache-catalog" di melostore-sync. Kalau
   * cache masih kosong, pesannya menyuruh menjalankan itu - bukan
   * diam-diam menarik API dan berharap tidak kena 429.
   */
  const client = new MelostoreSupplierClient();
  let meloCatalog: Array<{ sku: string; name: string; price: number }> = [];
  let meloError: string | null = null;

  {
    const cache = await bacaKatalogMelostore();

    if (cache.length === 0) {
      meloError = client.isConfigured()
        ? "Katalog Melostore belum disinkronkan. Jalankan \"Cache katalog\" di panel sinkronisasi."
        : "Kredensial Melostore belum diisi, dan katalog belum pernah disinkronkan.";
    } else {
      meloCatalog = cache;
    }
  }


  const [products, games, existing] = await Promise.all([
    supabaseSelect<ProductRow>("products", {
      select: "id,label,game_id,active",
      filters: { active: "eq.true" },
      order: "label.asc",
      limit: 2000,
    }),
    supabaseSelect<GameRow>("games", {
      select: "id,name",
      filters: { active: "eq.true" },
      order: "name.asc",
      limit: 300,
    }),
    supabaseSelect<ExistingMapping>("supplier_products", {
      select: "product_id,supplier_sku,supplier_cost",
      filters: { supplier_id: "eq.melostore" },
      limit: 2000,
    }),
  ]);

  const meloBySku = new Map(meloCatalog.map((s) => [s.sku, s]));
  const mappedByProduct = new Map(
    existing.map((m) => [m.product_id, m] as const),
  );

  const { matchProductToSupplier, isGameEligible, expectedPrefixes, normalizeLabel } =
    await import("@/lib/suppliers/match");

  const eligibleGames: GameOptions[] = games.map((g) => ({
    id: g.id,
    name: g.name,
    meloPrefixes: expectedPrefixes(g.id),
  }));

  /*
   * Kelompokkan produk per label, untuk mendeteksi bentrok.
   *
   * 57 label dipakai lebih dari satu produk. Produk yang labelnya dipakai
   * operator lain TIDAK boleh dipetakan otomatis meski pencocokan
   *okers memberikannya jawaban yang yakin - satu label untuk dua produk
   * berarti satu dari keduanya akan salah.
   */
  const byLabel = new Map<string, ProductRow[]>();
  for (const p of products) {
    const key = normalizeLabel(p.label);
    const list = byLabel.get(key);
    if (list) list.push(p);
    else byLabel.set(key, [p]);
  }

  const rows = [];
  for (const product of products) {
    if (gameFilter && product.game_id !== gameFilter) continue;
    if (query && !product.label.toLowerCase().includes(query)) continue;

    const mapped = mappedByProduct.get(product.id);
    if (onlyUnmapped && mapped?.supplier_sku) continue;

    const eligible = isGameEligible(product.game_id);
    const peers = byLabel.get(normalizeLabel(product.label)) ?? [];

    /*
     * Kandidat dari katalog yang tersaring label.
     *
     * Disaring DI SINI, bukan mengirim katalog utuh. Kalau katalog ikut
     * dikirim, satu produk bisa menarik 10.000 SKU ke browser.
     */
    const target = normalizeLabel(product.label);
    const candidates = meloCatalog
      .filter((s) => normalizeLabel(s.name) === target)
      .slice(0, 8)
      .map((s) => ({ sku: s.sku, name: s.name, cost: s.price }));

    const auto = eligible
      ? matchProductToSupplier(
          { id: product.id, label: product.label, gameId: product.game_id },
          candidates.map((c) => ({
            supplierId: "melostore" as const,
            sku: c.sku,
            cost: c.cost,
            stock: null,
            skuLabel: c.name,
          })),
        )
      : null;

    const mappedSku = mapped?.supplier_sku ?? null;
    const mappedCost = mapped ? Number(mapped.supplier_cost) : null;

    rows.push({
      productId: product.id,
      label: product.label,
      gameId: product.game_id,
      gameName: games.find((g) => g.id === product.game_id)?.name ?? product.game_id,
      eligible,
      mappedSku,
      mappedCost,
      autoSku: auto?.supplierSku ?? null,
      autoCost: auto?.supplierCost ?? null,
      autoConfidence: auto?.confidence ?? (eligible ? "none" : "none"),
      autoReason: auto?.reason ?? "game-not-allowed",
      candidates,
      conflictCount: peers.filter((p) => p.id !== product.id).length,
    });
  }

  /*
   * Daftar SKU per supplier untuk dropdown di editor produk.
   *
   * Editor membaca INI, bukan `rows` - karena satu daftar SKU berlaku
   * untuk semua produk, sedangkan `rows` adalah status pemetaan per
   * produk. Mengirim daftar penuh di setiap baris akan melipatgandakan
   * ukuran respons tanpa informasi tambahan.
   */
  const digiflazzCatalog = await supabaseSelectAll<{
    supplier_sku: string;
    product_name: string;
    supplier_cost: number | string;
  }>("supplier_catalog_items", {
    select: "supplier_sku,product_name,supplier_cost",
    filters: { supplier_id: "eq.digiflazz", buyer_active: "eq.true" },
    order: "product_name.asc",
  });

  const options = {
    digiflazz: digiflazzCatalog.map((b) => ({
      sku: b.supplier_sku,
      name: b.product_name,
      cost: Number(b.supplier_cost),
    })),
    melostore: meloCatalog.map((s) => ({
      sku: s.sku,
      name: s.name,
      cost: s.price,
    })),
  };

  return Response.json({
    supplier: {
      id: "melostore",
      label: "Melostore",
      configured: client.isConfigured(),
      catalogSize: meloCatalog.length,
      error: meloError,
    },
    games: eligibleGames,
    options,
    rows,
    summary: {
      total: rows.length,
      mapped: rows.filter((r) => r.mappedSku).length,
      autoExact: rows.filter((r) => r.autoConfidence === "exact" && !r.mappedSku).length,
      ambiguous: rows.filter((r) => r.autoReason === "multiple-supplier-sku").length,
      conflict: rows.filter((r) => r.conflictCount > 0).length,
      notEligible: rows.filter((r) => !r.eligible).length,
    },
  });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: { action?: string; productId?: string; sku?: string; cost?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  if (body.action === "apply-auto") return applyAutoMappings();
  if (body.action === "apply")
    return applyManualMapping(
      body.productId,
      body.sku,
      body.cost,
      auth.principal.userId,
    );
  if (body.action === "clear") return clearMapping(body.productId);
  if (body.action === "backfill-sku") return backfillInternalSku();

  return Response.json({ error: "Aksi tidak dikenal." }, { status: 400 });
}

async function applyManualMapping(
  productId: string | undefined,
  sku: string | undefined,
  cost: number | undefined,
  mappedBy: string | null,
) {
  if (!productId || !sku) {
    return Response.json(
      { error: "productId dan sku wajib diisi." },
      { status: 400 },
    );
  }

  const rows = await supabaseSelect<ProductRow>("products", {
    select: "id,label,game_id,active",
    filters: { id: `eq.${productId}`, active: "eq.true" },
    limit: 1,
  });
  const product = rows[0];
  if (!product) {
    return Response.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const client = new MelostoreSupplierClient();
  if (!client.isConfigured()) {
    return Response.json(
      { error: "Kredensial Melostore belum diisi, jadi harga tidak bisa diverifikasi." },
      { status: 503 },
    );
  }

  /*
   * Verifikasi SKU dan harga dari supplier, jangan percaya angka dari
   * browser.
   *
   * Klien mengirim `cost` yang dipakai operator; kalau angka itu dipakai
   * apa adanya, klien punya kontrol atas harga modal Lacte - dan
   * `supplier_cost` menentukan margin setiap order. Harga SELALU diambil
   * ulang dari supplier.
   */
  /*
   * Prefiks SKU harus cocok dengan game produk.
   *
   * UI menampilkan semua kandidat yang labelnya sama - termasuk SKU
   * milik game lain, karena label "50 Diamonds" ada di beberapa game.
   * Tanpa guard ini, satu klik salah memetakan produk Free Fire ke
   * SKU Mobile Legends, dan top up dikirim ke game yang salah.
   *
   * Pencocokan otomatis sudah menegakkan aturan ini; pemetaan manual
   * wajib mengikutinya. Kalau daftar prefiks suatu game terasa kurang,
   * yang perlu diperbaiki adalah daftarnya - bukan dilewati.
   */
  const { expectedPrefixes, supplierPrefix } = await import(
    "@/lib/suppliers/match",
  );
  const prefiksDibolehkan = expectedPrefixes(product.game_id);
  const prefiksSku = supplierPrefix(sku);
  if (
    prefiksDibolehkan.length > 0 &&
    (!prefiksSku || !prefiksDibolehkan.includes(prefiksSku))
  ) {
    return Response.json(
      {
        error:
          `SKU ${sku} tidak cocok dengan game ${product.game_id}. ` +
            `Prefiks yang sah: ${prefiksDibolehkan.join(", ")}.`,
      },
      { status: 422 },
    );
  }

  let verified: { sku: string; cost: number } | null = null;
  try {
    const quotes = await bacaKatalogMelostore();
    const found = quotes.find((q) => q.sku === sku.trim());
    if (!found) {
      return Response.json(
        { error: `SKU ${sku} tidak ada di katalog Melostore.` },
        { status: 422 },
      );
    }
    verified = { sku: found.sku, cost: found.price };
  } catch (error) {
    return Response.json(
      {
        error:
          "Katalog Melostore tidak bisa dimuat, jadi harga tidak bisa diverifikasi. " +
          (error instanceof Error ? error.message : ""),
      },
      { status: 503 },
    );
  }

  await supabaseInsert("supplier_products", {
    supplier_id: "melostore",
    product_id: productId,
    supplier_sku: verified.sku,
    supplier_cost: verified.cost,
    active: true,
    last_synced_at: new Date().toISOString(),
    /*
     * Metadata pemetaan. Spesifikasi: mapping manual mencatat admin yang
     * mengonfirmasi dan waktunya. Token legacy tidak membawa identitas
     * user (userId null) - itu jujur dicatat sebagai null, bukan
     * diberi nama palsu.
     */
    mapped_via: "manual",
    mapped_by: mappedBy,
    mapped_at: new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    productId,
    sku: verified.sku,
    cost: verified.cost,
  });
}

async function clearMapping(productId: string | undefined) {
  if (!productId) {
    return Response.json({ error: "productId wajib diisi." }, { status: 400 });
  }

  try {
    await supabaseDelete("supplier_products", {
      filters: {
        supplier_id: "eq.melostore",
        product_id: `eq.${productId}`,
      },
    });
  } catch (error) {
    console.error("Gagal menghapus pemetaan Melostore", error);
    return Response.json(
      { error: "Pemetaan gagal dihapus." },
      { status: 503 },
    );
  }

  return Response.json({ ok: true, productId });
}

async function applyAutoMappings() {
  const client = new MelostoreSupplierClient();
  if (!client.isConfigured()) {
    return Response.json(
      { error: "Kredensial Melostore belum diisi." },
      { status: 503 },
    );
  }

  const quotes = await bacaKatalogMelostore();
  const { matchProductToSupplier, isGameEligible, normalizeLabel } = await import(
    "@/lib/suppliers/match"
  );

  const [products, games] = await Promise.all([
    supabaseSelect<ProductRow>("products", {
      select: "id,label,game_id,active",
      filters: { active: "eq.true" },
      limit: 2000,
    }),
    supabaseSelect<GameRow>("games", {
      select: "id,name",
      filters: { active: "eq.true" },
      limit: 300,
    }),
  ]);

  const byLabel = new Map<string, ProductRow[]>();
  for (const p of products) {
    const key = normalizeLabel(p.label);
    const list = byLabel.get(key);
    if (list) list.push(p);
    else byLabel.set(key, [p]);
  }

  let applied = 0;
  let skippedConflict = 0;
  let skippedAmbiguous = 0;
  let skippedIneligible = 0;

  for (const product of products) {
    if (!isGameEligible(product.game_id)) {
      skippedIneligible += 1;
      continue;
    }

    /*
     * Label yang dipakai lebih dari satu produk TIDAK pernah dipasang
     * otomatis.
     *
     * Ini pemeriksaan kedua setelah `matchProductToSupplier` - yang itu
     * sudah menolak SKU ambigu, tapi tidak tahu bahwa Nambah sendiri
     * punya dua produk dengan label identik. Tanpa pemeriksaan ini, dua
     * produk sharing akan berebut SKU yang sama.
     */
    const peers = byLabel.get(normalizeLabel(product.label)) ?? [];
    if (peers.length > 1) {
      skippedConflict += 1;
      continue;
    }

    const hasil = matchProductToSupplier(
      { id: product.id, label: product.label, gameId: product.game_id },
      quotes.map((q) => ({
        supplierId: "melostore" as const,
        sku: q.sku,
        cost: q.price,
        stock: null,
        skuLabel: q.name,
      })),
    );

    if (!hasil.supplierSku || hasil.confidence !== "exact") {
      if (hasil.reason === "multiple-supplier-sku") skippedAmbiguous += 1;
      continue;
    }

    await supabaseInsert("supplier_products", {
      supplier_id: "melostore",
      product_id: product.id,
      supplier_sku: hasil.supplierSku,
      supplier_cost: hasil.supplierCost,
      active: true,
      last_synced_at: new Date().toISOString(),
      /* Pemasangan otomatis - hanya untuk kandidat yang pasti tunggal. */
      mapped_via: "auto",
      mapped_at: new Date().toISOString(),
    });
    applied += 1;
  }

  return Response.json({
    ok: true,
    applied,
    skippedAmbiguous,
    skippedConflict,
    skippedIneligible,
    totalScanned: products.length,
    message:
      `${applied} pasangan dipasang. ${skippedAmbiguous} ambigu wilayah, ` +
      `${skippedConflict} label bentrok, ${skippedIneligible} di luar daftar game.`,
  });
}

/**
 * Isi `products.internal_sku` untuk semua produk yang belum punya.
 *
 * KENAPA AKHIRAN, BUKAN ERROR
 *
 * Nambah punya beberapa SKU Digiflazz berbeda untuk label yang sama di
 * game yang sama (dua varian "50 Diamonds"). Generator yang deterministik
 * akan menghasilkan SKU sama untuk keduanya - dan spec melarang menimpa
 * produk yang sudah ada. Akhiran angka membuat keduanya tetap punya SKU
 * sendiri tanpa menyentuh yang terlanjur ada.
 *
 * KENAPA TIDAK DIJALANKAN OLEH MIGRASI SQL
 *
 * Normalisasi label dan alias brand punya aturan yang jauh lebih mudah
 * diuji di TypeScript (20 test). Aturan yang salah di SQL menjadi SKU
 * yang salah selamanya, dan memperbaikinya berarti mengubah SKU produk
 * yang sudah tersebar di laporan.
 *
 * IDEMPOTEN: produk yang sudah punya SKU dilewati, apa pun isinya.
 * Mengubah SKU yang sudah tersebar di nota dan laporan bukan bagian
 * dari pekerjaan ini.
 */
async function backfillInternalSku() {
  const [products, games] = await Promise.all([
    supabaseSelect<{ id: string; label: string; game_id: string; internal_sku?: string }>(
      "products",
      {
        select: "id,label,game_id,internal_sku",
        filters: { active: "eq.true" },
        limit: 5000,
      },
    ),
    supabaseSelect<{ id: string }>("games", {
      select: "id",
      filters: { active: "eq.true" },
      limit: 300,
    }),
  ]);

  const gameIds = new Set(games.map((g) => g.id));
  const dipakai = new Set(
    products
      .map((p) => p.internal_sku)
      .filter((sku): sku is string => Boolean(sku)),
  );

  let dibuat = 0;
  let dilewati = 0;
  const duplikat: string[] = [];

  for (const product of products) {
    if (product.internal_sku) {
      dilewati += 1;
      continue;
    }
    if (!gameIds.has(product.game_id)) {
      dilewati += 1;
      continue;
    }

    /*
     * Input generator: game dan label. Nominal dan jenis diekstrak dari
     * label di dalam generator; SKU Digiflazz tidak ikut karena SKU
     * internal justru harus tidak bergantung padanya.
     */
    const input = { gameId: product.game_id, label: product.label };
    let sku = generateInternalSku(input);

    if (sku && dipakai.has(sku)) {
      for (let suffix = 2; suffix < 50; suffix += 1) {
        const kandidat = internalSkuWithSuffix(input, suffix);
        if (kandidat && !dipakai.has(kandidat)) {
          sku = kandidat;
          break;
        }
      }
      duplikat.push(product.id);
    }

    if (!sku) {
      dilewati += 1;
      continue;
    }

    try {
      await supabaseUpdate(
        "products",
        { internal_sku: sku },
        {
          filters: {
            id: `eq.${product.id}`,
            internal_sku: "is.null",
          },
        },
      );
      dipakai.add(sku);
      dibuat += 1;
    } catch (error) {
      // Kalau dua permintaan bersamaan mengisi produk yang sama, yang
      // kedua gagal karena unique index - dan itu BENAR. Melewati tanpa
      // menggagalkan seluruh backfill.
      console.error(`Gagal mengisi SKU internal untuk ${product.id}`, error);
    }
  }

  return Response.json({
    ok: true,
    generated: dibuat,
    alreadyHad: dilewati,
    duplicatesResolved: duplikat.length,
    message:
      `${dibuat} SKU internal dibuat, ${dilewati} sudah punya dan dilewati.` +
        (duplikat.length > 0 ? ` ${duplikat.length} produk memakai akhiran karena labelnya sama.` : ""),
  });
}