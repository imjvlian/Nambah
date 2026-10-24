import { getActivePromotions } from "@/lib/public-promotions";

export const runtime = "nodejs";

/**
 * Promo yang sedang aktif — versi publik dari data halaman /promo.
 *
 * Dipakai OrderSummaryAdSlot (P4.5) di halaman order sukses; sengaja
 * digerbang endpoint sendiri, bukan memanggil lib dari komponen client,
 * karena getActivePromotions membaca database lewat service key.
 *
 * Data yang keluar sama persis dengan halaman /promo — hanya kolom
 * publik, tanpa timestamps atau angka internal (lihat public-promotions).
 */
export async function GET() {
  const promotions = await getActivePromotions();
  return Response.json(
    { promotions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
