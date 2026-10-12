import { authorizeAdminRequest } from "@/lib/admin-api";
import { MelostoreSupplierClient } from "@/lib/suppliers/melostore-client";
import {
  bukaScanRun,
  riwayatScan,
  tutupScanRun,
} from "@/lib/suppliers/scan-runs";
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

/**
 * Jejak scan Melostore, terbaru dulu.
 *
 * Dipakai panel katalog untuk menampilkan status scan terakhir: berhasil,
 * parsial, gagal, atau masih berjalan - beserta jumlah dan waktunya.
 */
export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const runs = await riwayatScan("melostore", 5);

  return Response.json({
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      pages: run.pages_total,
      pagesFailed: run.pages_failed,
      found: run.found_count,
      baru: run.new_count,
      updated: run.updated_count,
      unchanged: run.unchanged_count,
      deactivated: run.deactivated_count,
      error: run.error,
      triggeredBy: run.triggered_by,
    })),
    lastSuccessAt:
      runs.find((run) => run.status === "success")?.finished_at ?? null,
  });
}

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
  if (body.action === "cache-catalog")
    return cacheMelostoreCatalog(client, auth.principal.userId);

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
/**
 * Scan katalog Melostore: tarik, upsert, catat run.
 *
 * ATURAN YANG TIDAK BISA DILANGGAR DI FUNGSI INI
 *
 * 1. DEAKTIVASI HANYA SAAT SCAN SUKSES PENUH. Scan parsial kehilangan
 *    halaman - SKU yang hilang dari hasil parsial bisa jadi ada di
 *    halaman yang gagal. Menandainya tidak tersedia berarti menghapus
 *    produk dari dropdown hanya karena supplier sempat rate-limit.
 *
 * 2. RESPONS KOSONG AKIBAT ERROR BUKAN KATALOG KOSONG. Katalog 0 SKU
 *    dengan halaman gagal = scan gagal; katalog 0 SKU tanpa halaman
 *    gagal = supplier benar-benar kosong. Dua hal yang berbeda.
 *
 * 3. SETIAP RUN TERCATAT, TERMASUK YANG GAGAL. Tanpa jejak, operator
 *    tidak bisa membedakan "katalog belum pernah discan" dari "scan
 *    terakhir gagal tiga kali berturut-turut".
 */
async function cacheMelostoreCatalog(client: MelostoreSupplierClient, triggeredBy: string | null) {
  /*
   * Kunci anti-scan-bersamaan.
   *
   * Dua scan yang berjalan bersamaan menghitung "baru"/"diperbarui"
   * terhadap dasar yang berbeda - angkanya salah keduanya, bukan karena
   * Postgres salah tapi karena dasar perbandingannya berbeda.
   */
  const run = await bukaScanRun("melostore", triggeredBy);
  if (!run) {
    return Response.json(
      {
        error:
          "Scan Melostore masih berjalan. Tunggu sampai selesai sebelum menjalankan lagi.",
      },
      { status: 409 },
    );
  }

  try {
    const hasil = await client.scanCatalog();

    /*
     * Katalog kosong diperlakukan beda antara sukses dan gagal:
     * - sukses + 0 SKU  : supplier benar-benar kosong (hampir pasti salah
     *   konfigurasi akun, tapi itu fakta yang sah).
     * - gagal/parsial + 0 SKU : respons kosong karena error - BUKAN
     *   katalog kosong, dan BUKAN alasan menandai apa pun nonaktif.
     */
    if (hasil.items.length === 0) {
      const status: "failed" | "success" =
        hasil.pagesFailed > 0 ? "failed" : "success";
      await tutupScanRun(
        run.id,
        status,
        { pagesTotal: hasil.pagesTotal, pagesFailed: hasil.pagesFailed, found: 0 },
        status === "failed" ? hasil.errors.join(" | ") : undefined,
      );

      return Response.json(
        {
          error:
            status === "failed"
              ? "Scan gagal - tidak ada SKU yang bisa diambil. Tidak ada yang diubah."
              : "Katalog Melostore kosong - tidak ada yang disimpan.",
          scan: { status, pages: hasil.pagesTotal, failed: hasil.pagesFailed },
        },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();

    /*
     * Hitung baru/diperbarui/tidak-berubah SEBELUM upsert, terhadap
     * kondisi yang sedang ada. Dihitung setelahnya berarti membandingkan
     * dengan dasar yang sudah berubah - semuanya akan terlihat "tidak
     * berubah".
     */
    const lama = await supabaseSelect<{
      supplier_sku: string;
      supplier_cost: number | string;
      buyer_active: boolean;
    }>("supplier_catalog_items", {
      select: "supplier_sku,supplier_cost,buyer_active",
      filters: { supplier_id: "eq.melostore" },
      limit: 20000,
    });

    const sebelumnya = new Map(
      lama.map((b) => [b.supplier_sku, b] as const),
    );

    let baru = 0;
    let berubah = 0;
    let sama = 0;

    const UKURAN_BATCH = 500;
    const baris = hasil.items.map((item) => ({
      supplier_id: "melostore",
      supplier_sku: item.sku,
      product_name: item.name || item.sku,
      category: item.categoryName ?? "Melostore",
      /*
       * Brand ASLI dari meta.brands - bukan categoryName. Keduanya
       * pernah diisi nilai sama, sehingga pengelompokan per brand di
       * browser tidak pernah bisa membedakan "Mobile Legends" (brand)
       * dari "Game" (kategori).
       */
      brand: item.brandName ?? item.categoryName ?? "Melostore",
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
      inquiry_form_key: item.inquiryFormKey,
      last_seen_at: now,
    }));

    for (const row of baris) {
      const sebelum = sebelumnya.get(row.supplier_sku);
      if (!sebelum) baru += 1;
      else if (Number(sebelum.supplier_cost) !== row.supplier_cost || sebelum.buyer_active !== row.buyer_active) {
        berubah += 1;
      } else sama += 1;
    }

    for (let i = 0; i < baris.length; i += UKURAN_BATCH) {
      await supabaseUpsert("supplier_catalog_items", baris.slice(i, i + UKURAN_BATCH), {
        onConflict: "supplier_id,supplier_sku",
      });
    }

    /*
     * Definisi form input pelanggan, satu baris per form.
     *
     * Form dipakai ratusan SKU; kolom inquiry_form_key pada item
     * merujuk ke sini. Kalau tabelnya belum ada (migrasi 046 belum
     * dijalankan), upsert melempar - ditangkap dan dicatat supaya
     * scan tetap tersimpan, dan pesannya menyuruh menjalankan migrasi.
     */
    let formTersimpan = 0;
    try {
      const formRows = Object.entries(hasil.forms).map(([formKey, form]) => ({
        supplier_id: "melostore",
        form_key: formKey,
        fields: form.fields,
        notice: form.notice,
        synced_at: now,
      }));
      for (let i = 0; i < formRows.length; i += UKURAN_BATCH) {
        await supabaseUpsert("supplier_inquiry_forms", formRows.slice(i, i + UKURAN_BATCH), {
          onConflict: "supplier_id,form_key",
        });
      }
      formTersimpan = formRows.length;
    } catch (error) {
      console.warn(
        "Definisi form Melostore gagal disimpan - jalankan migrasi 046.",
        error instanceof Error ? error.message : String(error),
      );
    }

    /*
     * Deaktivasi HANYA saat sukses penuh. Scan parsial kehilangan halaman,
     * jadi SKU yang "hilang" bisa jadi ada di halaman yang gagal.
     */
    let ditandai = 0;
    const statusScan: "success" | "partial" =
      hasil.pagesFailed > 0 ? "partial" : "success";

    if (statusScan === "success") {
      const skuTersimpan = new Set(hasil.items.map((item) => item.sku));
      for (const barisLama of lama) {
        if (skuTersimpan.has(barisLama.supplier_sku)) continue;
        await supabaseUpdate(
          "supplier_catalog_items",
          { buyer_active: false, last_seen_at: now },
          {
            filters: {
              supplier_id: "eq.melostore",
              supplier_sku: `eq.${barisLama.supplier_sku}`,
            },
          },
        );
        ditandai += 1;
      }
    }

    await tutupScanRun(
      run.id,
      statusScan,
      {
        pagesTotal: hasil.pagesTotal,
        pagesFailed: hasil.pagesFailed,
        found: hasil.items.length,
        baru,
        updated: berubah,
        unchanged: sama,
        deactivated: ditandai,
      },
      statusScan === "partial" ? hasil.errors.join(" | ") : undefined,
    );

    return Response.json({
      ok: true,
      scan: {
        status: statusScan,
        pages: hasil.pagesTotal,
        pagesFailed: hasil.pagesFailed,
      },
      cached: baris.length,
      baru,
      updated: berubah,
      unchanged: sama,
      inactive: ditandai,
      forms: formTersimpan,
      message:
        (statusScan === "partial"
          ? `Scan PARSIAL (${hasil.pagesFailed} halaman gagal): `
          : "") +
        `${baris.length} SKU, ${baru} baru, ${berubah} diperbarui` +
        (statusScan === "success" ? `, ${ditandai} ditandai nonaktif.` : ".") +
        (formTersimpan > 0 ? ` ${formTersimpan} form input tersimpan.` : ""),
    });
  } catch (error) {
    const pesan = error instanceof Error ? error.message : "galat tidak diketahui";
    await tutupScanRun(run.id, "failed", {}, pesan);
    return Response.json(
      {
        error: "Scan gagal - tidak ada yang diubah. " + pesan,
      },
      { status: 502 },
    );
  }
}
