import { MelostoreSupplierClient } from "@/lib/suppliers/melostore-client";
import { DigiflazzSupplierClient } from "@/lib/suppliers/digiflazz-client";
import { registerSupplier } from "@/lib/suppliers/registry";

/**
 * Titik registrasi supplier.
 *
 * File ini adalah SATU-SATUNYA tempat di mana supplier terdaftar. Registry
 * sengaja terpisah supaya modul `@/lib/suppliers/registry` bisa diimpor
 * oleh test tanpa ikut memuat klien dan membaca `process.env`.
 *
 * Registrasi adalah efek samping saat modul dimuat. Kalau file ini
 * tidak diimpor siapa pun, `registerSupplier(...)` tidak akan pernah
 * berjalan - dan gejalanya muncul jauh dari penyebabnya:
 * `getSupplierClient` melempar dari dalam jalur order, saat order
 * sedang diproses.
 *
 * `import "@/lib/suppliers/register-suppliers"` di `fulfillment.ts`
 * yang membuatnya berjalan. Baris itu ada supaya tidak ikut terhapus
 * saat merapikan.
 */

registerSupplier("digiflazz", () => new DigiflazzSupplierClient());
registerSupplier("melostore", () => new MelostoreSupplierClient());

/*
 * Melostore sudah didaftarkan, tapi belum dipilih order.
 *
 * Pendaftaran di sini hanya membuat kliennya bisa dipanggil - balance,
 * katalog, webhook. `orders.supplier_id` masih selalu "digiflazz"
 * (lihat `src/app/api/orders/route.ts`), jadi memilih Melostore butuh
 * Tahap 4: sync `supplier_products` dan pemasangan pemilihan supplier
 * di checkout.
 */