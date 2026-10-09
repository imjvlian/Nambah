/**
 * Nama tampilan game yang berbeda dari nilai di tabel `games`.
 *
 * `games.name` diisi `catalog-sync` dari brand SKU, jadi isinya apa adanya:
 * "Lifeafter Credits". "Credits" itu nama mata uang dalam game, bukan bagian
 * dari nama game — pasar mengenal game ini sebagai "LifeAfter".
 *
 * Kenapa override di kode, bukan `update games set name = ...` di database:
 *
 * `id` di database HARUS tetap `lifeafter-credits`, karena `makeGameDefaults`
 * menurunkannya dari slug brand. Brand-nya persis "LifeAfter Credits", jadi
 * sync berikutnya akan selalu membuat id `lifeafter-credits` lagi. Kalau `id`
 * ikut diubah jadi `lifeafter`, tidak ada satu pun dari tiga kondisi
 * pencocokan `resolveGame` yang terpenuhi — `resolveGame` mengembalikan
 * `create: true` dan sync membuat game DUPLIKAT dengan 17 produk yang sama.
 *
 * `games.name` sendiri boleh diubah tanpa merusak pencocokan selama `id`
 * tetap, karena `resolveGame` masih cocok lewat `id`. Tapi Override diletakkan
 * di kode supaya nama di database tetap apa adanya output `catalog-sync`.
 *
 * Modul ini tanpa import: dipakai dari server components, API route, dan test.
 */

/** Nama game yang ditampilkan ke pengguna. */
export type GameDisplayNames = {
  name: string;
  shortName: string;
};

/**
 * Override per `game.id`.
 *
 * Kunci HARUS `game.id` yang ada di tabel `games`, bukan nama brand dari
 * Digiflazz — keduanya berbeda untuk LifeAfter.
 */
const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, GameDisplayNames>> = {
  "lifeafter-credits": { name: "LifeAfter", shortName: "LifeAfter" },
};

/**
 * Nama tampilan untuk satu game.
 *
 * Selalu mengembalikan nilai: kalau tidak ada override, nama dari database
 * dipakai apa adanya. Tidak pernah mengembalikan `undefined`, supaya tidak ada
 * jalur kode yang diam-diam jatuh ke `game.id`.
 */
export function gameDisplayNames(
  gameId: string,
  databaseNames: { name: string; shortName: string },
): GameDisplayNames {
  return DISPLAY_NAME_OVERRIDES[gameId] ?? databaseNames;
}

/** Nama tampilan saja, untuk jalur yang hanya butuh satu string. */
export function gameDisplayName(gameId: string, databaseName: string): string {
  return DISPLAY_NAME_OVERRIDES[gameId]?.name ?? databaseName;
}