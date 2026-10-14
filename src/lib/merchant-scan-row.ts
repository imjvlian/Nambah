/**
 * Bentuk baris order untuk pemindaian kasir - bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `merchant-retail.ts` karena modul latter mengimpor
 * `server-only` dan Supabase, sementara normalisasi BARIS INI justru
 * tempat bug yang paling mahal pernah menyamar: kalau gagal diam-diam,
 * kasir yang order-nya benar tetap ditolak dengan "Kode ini bukan untuk
 * toko Anda" dan tidak ada jejaknya di mana pun.
 *
 * BENTUK JAWABAN POSTGREST
 *
 * Untuk relasi to-one, PostgREST tidak membungkus baris di bawah kunci
 * tabel. `select=id,merchant_id,...,merchants!left(name)` menghasilkan:
 *
 *   { id, merchant_id, status, final_price, expires_at,
 *     merchants: { name } }
 *
 * Kolom order tetap DATAR di level atas. Versi lama pernah membaca
 * `row.orders`, yang tidak pernah ada - spread dari `undefined`
 * menghasilkan objek yang HANYA berisi `merchant_name`, sehingga
 * `merchant_id` jadi `undefined` dan cek kepemilikan selalu gagal.
 */

/** Bentuk baris order yang dibutuhkan pemindaian kasir. */
export type MerchantScanOrder = {
  id: string;
  merchant_id: string | null;
  merchant_name: string | null;
  status: string;
  final_price: number | string;
  expires_at: string | null;
};

/** Baris mentah dari PostgREST: kolom order datar + relasi `merchants`. */
export type MerchantScanRow = Omit<MerchantScanOrder, "merchant_name"> & {
  merchants: unknown;
};

/**
 * Nama toko dari relasi Foreign Key.
 *
 * PostgREST mengirim relasi to-one sebagai objek, tapi bentuk jawaban
 * tidak dijamin lintas versi - karena itu dua-duanya dinormalisasi di
 * sini, bukan di pemanggil.
 */
export function relatedMerchantName(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return null;
  const picked = (first as Record<string, unknown>).name;
  return typeof picked === "string" ? picked : null;
}

/**
 * Ubah satu baris mentah PostgREST menjadi baris yang siap dipakai.
 *
 * Mengembalikan `null` kalau baris tidak punya `id` - order tanpa id
 * tidak bisa dipakai untuk apa pun, dan membiarkan `undefined` lolos
 * akan memindahkan kegagalan ke tempat yang jauh lebih sulit dibaca.
 */
export function normalizeMerchantScanRow(
  row: MerchantScanRow | null | undefined,
): MerchantScanOrder | null {
  if (!row || typeof row.id !== "string" || row.id.length === 0) return null;

  const { merchants, ...order } = row;
  return { ...order, merchant_name: relatedMerchantName(merchants) };
}