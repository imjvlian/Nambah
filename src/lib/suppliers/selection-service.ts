import { supabaseSelectAll } from "@/lib/supabase/server";
import { loadAvailableBalances } from "@/lib/suppliers/reservation";
import { pilihSupplier } from "@/lib/suppliers/select";
import type { SupplierSelection } from "@/lib/suppliers/select";
import type { SupplierId, SupplierQuote } from "@/lib/suppliers/types";

/**
 * Service pemilihan supplier untuk satu produk.
 *
 * `pilihSupplier` di `select.ts` adalah modul murni yang sudah tervalidasi
 * - perannya menentukan aturan. Modul ini perannya menyediakan DATA:
 * quote dari `supplier_products` dan saldo dari `supplier_balances`,
 * lalu menyerahkan keputusannya ke aturan yang sama untuk semua
 * pemanggil. Kalau tiap pemanggil membaca tabelnya sendiri, dua tempat
 * bisa menghitung pilihan yang berbeda untuk order yang sama.
 *
 * KENAPA SEKARANG, BUKAN SAAT EKSEKUSI
 *
 * Supplier dipilih saat order dibuat supaya harga yang dibekukan ke
 * order (supplier_cost) adalah harga supplier yang benar-benar akan
 * dipakai - nota, laporan margin, dan max_price saat dispatch semuanya
 * membaca angka yang sama. Memilih saat eksekusi membuat snapshot itu
 * bohong untuk sebagian order.
 */

type MappingRow = {
  supplier_id: string;
  supplier_sku: string | null;
  supplier_cost: number | string;
  active: boolean;
};

/**
 * Supplier yang boleh dipilih otomatis.
 *
 * Baris mapping supplier lain (kalau suatu saat ada) tidak ikut - tanpa
 * daftar ini, supplier yang kliennya belum terdaftar di registry bisa
 * terpilih lalu gagal saat dispatch dengan pesan yang menyesatkan.
 */
const SUPPLIER_OTOMATIS = ["digiflazz", "melostore"];

export async function pilihSupplierUntukProduk(
  productId: string,
  opsi?: {
    /**
     * Anggap saldo semua supplier tak terbatas.
     *
     * Flow test mode tidak pernah membayar supplier sungguhan, jadi
     * saldo Rp 0 di tabel tidak boleh menolak order uji - kalau tidak,
     * produk yang hanya terpetakan ke Melostore tidak pernah bisa
     * diuji end-to-end sebelum saldo supplier disetor.
     *
     * Aturan "termurah menang" dan pemutus seri TIDAK berubah: yang
     * dilewati hanya saringan saldo.
     */
    abaikanSaldo?: boolean;
  },
): Promise<SupplierSelection> {
  const [mappings, balances] = await Promise.all([
    supabaseSelectAll<MappingRow>("supplier_products", {
      select: "supplier_id,supplier_sku,supplier_cost,active",
      filters: {
        supplier_id: `in.(${SUPPLIER_OTOMATIS.join(",")})`,
        product_id: `eq.${productId}`,
        active: "eq.true",
      },
    }),
    loadAvailableBalances(),
  ]);

  const quotes: SupplierQuote[] = mappings.flatMap((row) => {
    if (!row.supplier_sku) return [];
    const cost = Number(row.supplier_cost);
    if (!Number.isFinite(cost) || cost <= 0) return [];
    return [
      {
        supplierId: row.supplier_id as SupplierId,
        sku: row.supplier_sku,
        cost,
        /*
         * Stok tidak disimpan di supplier_products - ketersediaan sudah
         * diwakili `active`. null berarti "tidak diketahui" dan TIDAK
         * menolak quote (lihat kontrak di types.ts).
         */
        stock: null,
      },
    ];
  });

  const saldoEfektif = opsi?.abaikanSaldo
    ? balances.map((b) => ({
        supplierId: b.supplierId,
        balance: Number.MAX_SAFE_INTEGER,
        reserved: 0,
      }))
    : balances;

  return pilihSupplier(quotes, saldoEfektif);
}
