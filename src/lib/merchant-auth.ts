import "server-only";

import { supabaseSelect } from "@/lib/supabase/server";
import { verifyMerchantPin } from "@/lib/merchant-pin";

/**
 * Autentikasi kasir merchant.
 *
 * Merchant TIDAK memakai sesi Supabase untuk memindai pesanan. Alasannya
 * operasional, bukan teknis: kasir berdiri di konter dengan satu perangkat
 * yang sering berganti, dan tidak punya email. `merchants.user_id` tetap
 * disediakan untuk merchant yang memang punya akun, tapi jalur ini cukup
 * untuk pekerjaan harian.
 *
 * PIN dan hash-nya TIDAK pernah dicatat di log. Satu baris log yang keliru
 * saja sudah cukup untuk memberi akses ke konter orang lain.
 *
 * Format hash (`scrypt$N$r$p$salt$hash`) dan pembandingannya ada di
 * `merchant-pin.ts`; file ini hanya interfacing ke database.
 */
export type MerchantAuthRow = {
  id: string;
  name: string;
  code: string;
  status: "pending" | "active" | "frozen" | "inactive";
  pin_hash: string | null;
};

/**
 * Autentikasi `code` + `pin`.
 *
 * Mengembalikan `null` untuk SEMUA kegagalan - kode tidak ada, PIN salah,
 * atau hash rusak. Pemanggil tidak boleh bisa membedakan ketiganya lewat
 * pesan yang dikembalikan, karena itu mengubah halaman login toko menjadi
 * alat untuk menebak daftar kode yang aktif.
 */
export async function resolveMerchantForCode(
  code: string,
  pin: string,
): Promise<MerchantAuthRow | null> {
  const normalizedCode = code.trim();
  if (!normalizedCode || !pin) return null;

  const [merchant] = await supabaseSelect<MerchantAuthRow>("merchants", {
    select: "id,name,code,status,pin_hash",
    filters: { code: `eq.${normalizedCode}` },
    limit: 1,
  });

  if (!merchant || !merchant.pin_hash) return null;
  if (!verifyMerchantPin(pin, merchant.pin_hash)) return null;

  return merchant;
}