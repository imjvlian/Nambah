import {
  getActiveMerchants,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";

/**
 * GET /api/merchants — daftar toko ritel yang bisa dipilih di checkout.
 *
 * PUBLIK dan tanpa autentikasi, karena dipakai di halaman checkout yang
 * bisa diakses siapa pun, termasuk tamu yang belum login.
 *
 * Yang SENGAJA tidak dikirim: `code` dan `pin_hash`. Kode toko adalah
 * setengah kredensial kasir — mengirimnya ke browser pembeli berarti siapa pun
 * yang membuka DevTools bisa mendapatkannya, dan tinggal menebak PIN
 * enam digit untuk masuk ke konter.
 *
 * Filter `status = active` ada di `getActiveMerchants`, jadi toko yang
 * dibekukan karena menunggak tidak akan muncul di sini.
 */
export async function GET() {
  if (!isMerchantRetailEnabled()) {
    return Response.json({ merchants: [] });
  }

  const rows = await getActiveMerchants();

  return Response.json(
    {
      merchants: rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
      })),
    },
    {
      headers: {
        // Daftar toko berubah jarang, tapi tetap perlu invalidated begitu
        // admin membuat atau mengedit toko.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}