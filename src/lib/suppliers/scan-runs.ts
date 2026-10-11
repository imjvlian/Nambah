/**
 * Jejak scan katalog supplier.
 *
 * Satu-satunya tempat yang tahu "scan terakhir kapan, berhasil atau tidak,
 * berapa yang ditemukan". Tanpa ini, tombol scan hanya menghasilkan
 * notifikasi sekali pakai yang hilang setelah refresh - dan operator tidak
 * punya cara mengetahui bahwa katalog yang sedang ia petakan ternyata
 * hasil scan tiga hari lalu yang sebagian gagal.
 *
 * KUNCI ANTI-SCAN-BERSAMAAN
 *
 * Baris dengan status `running` berlaku sebagai kunci: sebelum memulai,
 * route memeriksa apakah masih ada baris running yang segar untuk
 * supplier yang sama. Dua scan yang menulis ke supplier_catalog_items
 * bersamaan membuat jumlah "baru" dan "diperbarui" tidak bisa dipercaya -
 * bukan karena Postgres-nya salah, tapi karena keduanya menghitung
 * terhadap dasar yang berbeda.
 *
 * Batas segar 15 menit: kalau ada scan yang menggantung lebih lama dari
 * itu (proses mati sebelum sempat menutup run), barisnya dianggap mati
 * dan scan baru boleh jalan. Tanpa batas ini, satu crash akan mengunci
 * scan selamanya.
 */

import { supabaseInsert, supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";
import type { SupplierId } from "@/lib/suppliers/types";

export type ScanRunStatus = "running" | "success" | "partial" | "failed";

export type ScanRunRow = {
  id: number;
  supplier_id: string;
  status: ScanRunStatus;
  started_at: string;
  finished_at: string | null;
  pages_total: number | null;
  pages_failed: number | null;
  found_count: number | null;
  new_count: number | null;
  updated_count: number | null;
  unchanged_count: number | null;
  deactivated_count: number | null;
  error: string | null;
  triggered_by: string | null;
};

/** Scan dianggap mati kalau masih `running` setelah selama ini. */
const STALE_RUNNING_MS = 15 * 60 * 1000;

/**
 * Buka run baru, atau `null` kalau masih ada scan yang berjalan.
 *
 * `null` bukan error - itu kabar "tunggu dulu". Route yang menerima null
 * harus membalas 409 supaya UI menampilkannya sebagai "sedang berjalan",
 * bukan sebagai kegagalan server.
 */
export async function bukaScanRun(
  supplierId: SupplierId,
  triggeredBy: string | null,
): Promise<{ id: number } | null> {
  const batas = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  const berjalan = await supabaseSelect<{ id: number; started_at: string }>(
    "supplier_scan_runs",
    {
      select: "id,started_at",
      filters: { supplier_id: `eq.${supplierId}`, status: "eq.running" },
      order: "started_at.desc",
      limit: 1,
    },
  );

  if (berjalan.length > 0 && berjalan[0].started_at > batas) {
    return null;
  }

  /*
   * Scan yang menggantung melewati batas ditandai gagal - bukan dihapus.
   * Menghapus baris run berarti menghapus bukti bahwa ada scan yang mati
   * di tengah jalan, dan justru kejadian itulah yang paling perlu
   * diketahui operator.
   */
  for (const lama of berjalan) {
    await supabaseUpdate(
      "supplier_scan_runs",
      {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "Scan sebelumnya berhenti tanpa menutup run (proses mati).",
      },
      { filters: { id: `eq.${lama.id}`, status: "eq.running" } },
    );
  }

  const inserted = await supabaseInsert<{ id: number }>("supplier_scan_runs", {
    supplier_id: supplierId,
    status: "running",
    triggered_by: triggeredBy,
  });

  return inserted[0] ?? null;
}

export async function tutupScanRun(
  runId: number,
  status: Exclude<ScanRunStatus, "running">,
  angka: {
    pagesTotal?: number;
    pagesFailed?: number;
    found?: number;
    baru?: number;
    updated?: number;
    unchanged?: number;
    deactivated?: number;
  },
  error?: string,
): Promise<void> {
  await supabaseUpdate(
    "supplier_scan_runs",
    {
      status,
      finished_at: new Date().toISOString(),
      ...(angka.pagesTotal !== undefined ? { pages_total: angka.pagesTotal } : {}),
      ...(angka.pagesFailed !== undefined ? { pages_failed: angka.pagesFailed } : {}),
      ...(angka.found !== undefined ? { found_count: angka.found } : {}),
      ...(angka.baru !== undefined ? { new_count: angka.baru } : {}),
      ...(angka.updated !== undefined ? { updated_count: angka.updated } : {}),
      ...(angka.unchanged !== undefined ? { unchanged_count: angka.unchanged } : {}),
      ...(angka.deactivated !== undefined
        ? { deactivated_count: angka.deactivated }
        : {}),
      ...(error ? { error: error.slice(0, 500) } : {}),
    },
    { filters: { id: `eq.${runId}` } },
  );
}

/** Sejarah scan terbaru untuk satu supplier, terbaru dulu. */
export async function riwayatScan(
  supplierId: SupplierId,
  limit = 5,
): Promise<ScanRunRow[]> {
  return supabaseSelect<ScanRunRow>("supplier_scan_runs", {
    select:
      "id,supplier_id,status,started_at,finished_at,pages_total,pages_failed," +
      "found_count,new_count,updated_count,unchanged_count,deactivated_count,error,triggered_by",
    filters: { supplier_id: `eq.${supplierId}` },
    order: "started_at.desc",
    limit,
  });
}