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

// Melostore didaftarkan pada Tahap 2, bersama kliennya. Belum ada di
// sini lebih awal hanya akan membuat `isConfigured()` mengembalikan
// false tanpa pernah bisa dihitung - dan UI admin akan menampilkan
// supplier yang kelihatan siap padahal belum punya kredensial.