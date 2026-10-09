/**
 * Atribusi affiliate: apakah sebuah order berhak mendapat komisi?
 *
 * Modul ini murni keputusan — tidak menyentuh database. Semua query sudah
 *-containir di route, modul ini hanya menguji dan memutuskan. Itu supaya aturan
 * cooldown bisa diuji tanpa database sama sekali.
 *
 * ── Dua mekanisme yang BERBEDA, jangan dicampur ──────────────────────────
 *
 * KODE (input manual di checkout):
 *   - hanya untuk pengguna login. `pricing-repository.ts` mengembalikan 401
 *     kalau `referralCode` ada tapi `userId` kosong.
 *   - pembeli dapat DISKON, affiliate dapat komisi.
 *
 * LINK (`/r/[code]`):
 *   - untuk semua orang, termasuk tamu yang belum login.
 *   - pembeli TIDAK dapat apa-apa. Tidak ada diskon, tidak ada points.
 *   - affiliate mendapat komisi dari laba order itu.
 *
 * Konsekuensi untuk cooldown: order tamu tidak pernah punya kode affiliate,
 * jadi tidak bisa memicu cooldown lewat kode. Satu-satunya jalan komisi untuk
 * tamu adalah link, dan itu punya catatan sendiri di bawah.
 *
 * ── Cooldown 24 jam ──────────────────────────────────────────────────────
 *
 * Aturannya: satu user tidak bisa mendapat komisi dari affiliate yang sama
 * dua kali dalam 24 jam. Beli kedua tetap BOLEH — yang nol hanya komisinya.
 * Menolak order-nya akan terasa seperti_plateau dan bisa membuat orangulsive.
 *
 * Yang dikunci adalah AFFILIATE, bukan kode. Kalau dikunci per kode, affiliate
 * yang ganti kode (atau punya kode lama dan baru) akan lolos dari cooldown —
 * persis yang harus dicegahnya.
 *
 * Hanya order `success` yang memicu. `pending_payment` bisa menggantung
 * berhari-hari lalu dibatalkan, jadi menghitungnya memungkinkan affiliate
 * memblokir cooldown-nya dengan order yang tak pernah dibayar.
 *
 * ── Batas kekuatan session key ───────────────────────────────────────────
 *
 * `sessionKey` berasal dari cookie. Siapa pun bisa menghapusnya, dan setelah
 * itu cooldown tidak mengenali dia lagi. Ini keputusan yang disengaja —
 * alternatifnya IP, yang menyakiti pengguna sah yang berbagi IP di kos,
 * kantor, atau jaringan seluler yang IP-nya berubah.
 *
 * Artinya ini PENCEGAHAN RINGAN. Tidak boleh dipakai sebagai satu-satunya
 * alasan menolak order; kalau dipakai begitu, pengguna sah yang cookie-nya
 * hilang akan ikut terkunci 24 jam tanpa sebab.
 */

export const AFFILIATE_COOLDOWN_HOURS = 24;

/** Order yang statusnya sudah selesai dan menghasilkan komisi. */
const COMMISSIONABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(["success"]);

/**
 * Berapa lama lagi cooldown ini aktif.
 *
 * Mengembalikan detik; `0` berarti tidak aktif. Mengembalikan sisa waktu —
 * bukan hanya boolean — supaya pemanggil bisa memberi tahu user kapan bisa
 * Beli lagi dengan kode itu, bukan hanya "ditolak".
 */
export function cooldownRemainingMs(
  lastCommissionedAt: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!lastCommissionedAt) return 0;
  const timestamp = new Date(lastCommissionedAt).getTime();
  if (Number.isNaN(timestamp)) return 0;

  const windowMs = AFFILIATE_COOLDOWN_HOURS * 60 * 60 * 1000;
  const elapsed = now - timestamp;
  if (elapsed < 0) return windowMs;
  return Math.max(0, windowMs - elapsed);
}

/**
 * Hasil pemeriksaan cooldown untuk satu order.
 *
 * `blocked: true` berarti komisi TIDAK dihitung untuk order ini. Order-nya
 * sendiri tetap boleh dibuat.
 */
export type CooldownDecision =
  | { blocked: false; reason: null }
  | {
      blocked: true;
      reason: "cooldown";
      /** Sisa cooldown dalam milidetik. Selalu > 0 saat `blocked`. */
      remainingMs: number;
      /** Affiliate yang memblokir, untuk pesan yang bisa dipahami user. */
      affiliateCode: string;
    };

const ALLOWED: CooldownDecision = { blocked: false, reason: null };

/**
 * Status order apa pun yang pernah mendapat komisi dari affiliate ini.
 *
 * Hanya `success` yang dianggap. Lihat catatan di header modul.
 */
export function triggersCooldown(orderStatus: string): boolean {
  return COMMISSIONABLE_ORDER_STATUSES.has(orderStatus);
}

/**
 * Periksa apakah order ini kena cooldown.
 *
 * `lastCommissionedAt` harus berisi waktu order `success` TERAKHIR dari user
 * ini yang memakai kode affiliate yang sama. Kalau null, tidak ada cooldown.
 *
 * Parameter `orderStatus` dipakai supaya pemanggil bisa menyaring sebelum
 * melakukan query yang mahal — memanggil fungsi ini dengan status `pending`
 * selalu mengembalikan `blocked: false`.
 */
export function evaluateCooldown({
  affiliateCode,
  orderStatus,
  lastCommissionedAt,
  now = Date.now(),
}: {
  affiliateCode: string;
  orderStatus: string;
  lastCommissionedAt: string | null | undefined;
  now?: number;
}): CooldownDecision {
  if (!affiliateCode) return ALLOWED;
  if (!triggersCooldown(orderStatus)) return ALLOWED;

  const remainingMs = cooldownRemainingMs(lastCommissionedAt, now);
  if (remainingMs <= 0) return ALLOWED;

  return { blocked: true, reason: "cooldown", remainingMs, affiliateCode };
}

/**
 * Sisa cooldown dalam jam, dibulatkan ke atas.
 *
 * Untuk pesan user: "coba lagi dalam 5 jam" lebih berguna daripada
 * "18123847 milidetik". `Math.ceil` supaya 1 menit tersisa tetap يقول 1 jam,
 * tidak 0 — kalau 0 jam, user akan mengira cooldown-nya sudah habis.
 */
export function remainingHours(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
}

/** Halaman administrator: "0 klik" tidak sama dengan "0% konversi". */
export function conversionRate(clicks: number, orders: number): number | null {
  if (clicks <= 0) return null;
  return orders / clicks;
}
