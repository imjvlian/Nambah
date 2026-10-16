import "server-only";

import {
  resolveMerchantForCode,
  type MerchantAuthRow,
} from "@/lib/merchant-auth";
import { rateLimitResponse } from "@/lib/rate-limit";
/**
 * Autentikasi kasir untuk endpoint merchant.
 *
 * `lookup` dan `confirm` memakai fungsi yang SAMA persis. Kalau keduanya
 * punya logikanya sendiri, akan datang saatnya keduanya berbeda — dan
 * route yang bisa memindai tanpa login adalah lubang yang sangat mahal.
 *
 * Mengembalikan `{ merchant }` kalau berhasil, atau `Response` yang sudah
 * siap dikembalikan kalau gagal.
 */
export async function authenticateMerchant(
  request: Request,
  body: { code?: unknown; pin?: unknown },
  rateLimitScope: string,
): Promise<{ merchant: MerchantAuthRow } | { response: Response }> {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";

  /*
   * Rate limit DITARUH DI ATAS validasi input, bukan di bawahnya.
   *
   * Alasannya: endpoint ini menerima input bebas dari perangkat yang
   * dikuasai orang asing, dan `verifyMerchantPin` sengaja mahal (scrypt).
   * Tanpa rate limit di sini, siapa pun bisa membuat server melakukan
   * hashing terus-menerus hanya dengan mengirim PIN asal.
   *
   * 30 permintaan per menit, bukan 10. Kasir biasanya satu perangkat per
   * toko, tapi balasan di balik IP yang sama ketika dua orang memakai
   * perangkat berbeda. 10 akan mengunci kasir karena rekannya salah ketik.
   */
  const limited = await rateLimitResponse(request, {
    scope: rateLimitScope,
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return { response: limited };

  if (!code || !pin) {
    return {
      response: Response.json(
        { error: "Kode toko dan PIN wajib diisi." },
        { status: 400 },
      ),
    };
  }

  /*
   * Limit per kode toko, di atas limit per IP.
   *
   * PIN-nya 6 digit. Tanpa limit per kode, botnet yang tahu kode toko bisa
   * mencoba PIN dari banyak IP tanpa pernah kena lockout di toko itu.
   */
  const codeLimited = await rateLimitResponse(request, {
    scope: `${rateLimitScope}_code`,
    limit: 10,
    windowSeconds: 300,
    subject: code,
  });
  if (codeLimited) return { response: codeLimited };

  const merchant = await resolveMerchantForCode(code, pin);

  if (!merchant) {
    /*
     * Satu pesan untuk "kode tidak ada" dan "PIN salah". Membedakan keduanya
     * akan membantu penyerang: dia bisa menguji daftar kode toko tanpa PIN
     * yang benar.
     */
    return {
      response: Response.json(
        { error: "Kode toko atau PIN salah." },
        { status: 401 },
      ),
    };
  }

  if (merchant.status !== "active") {
    /*
     * Pesannya dibedakan per status karena kasir perlu tahu APA yang harus
     * dilakukan, bukan cuma bahwa ada masalah:
     *
     * - `pending`: toko belum disetujui admin. Ini yang akan dilihat rhino
     *   yang baru daftar dan mencoba langsung memindai.
     * - `frozen`: ada piutang yang belum lunas.
     */
    return {
      response: Response.json(
        {
          error:
            merchant.status === "pending"
              ? "Toko ini belum disetujui admin."
              : merchant.status === "frozen"
                ? "Toko sedang dibekukan karena ada piutang yang belum lunas."
                : "Toko sedang tidak menerima pesanan.",
        },
        { status: 403 },
      ),
    };
  }

  return { merchant };
}
