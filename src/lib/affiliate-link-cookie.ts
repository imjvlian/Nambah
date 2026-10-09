/**
 * Membaca kode affiliate dari cookie.
 *
 * Cookie ditulis oleh `/r/[code]`. Kode ini hanya memberi KOMISI — pembeli
 * tidak dapat diskon dan tidak perlu login.
 *
 * Dibaca di server, bukan dikirim dari client. Kalau client yang mengirim,
 * orang bisa menulis request langsung dengan kode affiliate mana pun dan
 * komisinya masuk ke affiliate yang tidak mengarahkan dia.
 *
 * Kode yang diketik manual tetap menang — `pricing-repository.ts` hanya memakai
 * `linkCode` kalau `referralCode` kosong.
 */

const CODE_COOKIE = "nambah_ref_code";

/** Bentuk yang boleh, sama dengan yang dipakai `/r/[code]`. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      try {
        jar.set(name, decodeURIComponent(value));
      } catch {
        // Cookie rusak (bukan percent-encoding). Diabaikan — tidak boleh
        // menggagalkan seluruh request pricing.
        jar.set(name, value);
      }
    }
  }
  return jar;
}

/**
 * Kode affiliate dari cookie, atau string kosong.
 *
 * Mengembalikan string kosong — bukan error — kalau cookie tidak ada atau
 * isinya tidak valid. Link yang tidak berlaku harus tetap bisa sampai ke checkout —
 * order jangan gagal karena cookie aneh.
 */
export function readLinkReferralCode(request: Request): string {
  const raw = parseCookieHeader(request.headers.get("cookie")).get(CODE_COOKIE);
  if (!raw) return "";
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : "";
}
