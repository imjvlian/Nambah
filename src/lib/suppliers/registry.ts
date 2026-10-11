import type { SupplierClient, SupplierId } from "@/lib/suppliers/types";
import { isSupplierId, knownSupplierIds } from "@/lib/suppliers/types";

/**
 * Pemetaan id supplier -> cara membuatnya.
 *
 * KENAPA ADA
 *
 * Tanpa registry ini, setiap tempat yang perlu talking dengan supplier
 * akan tumbuh seperti ini:
 *
 * ```ts
 * if (supplierId === "digiflazz") { ... }
 * else if (supplierId === "melostore") { ... }
 * else throw new Error("supplier tidak dikenal");
 * ```
 *
 * Dan pola itu akan ter-copy ke `fulfillment.ts`, route webhook, admin
 * panel, dan job cron. Tiap salinan punya daftar yang bisa berbeda, dan
 * perbedaan itu baru ketahuan saat ada order yang lewat jalur yang lupa
 * mendaftarkan supplier baru.
 *
 * Registry membuat daftar itu jadi satu. Tambah supplier = tambah satu
 * baris di sini, bukan cari semua `else if` di seluruh codebase.
 *
 * KENAPA ID DITOLAK DI RUNTIME
 *
 * `orders.supplier_id` adalah kolom TEXT, bukan enum. Nilainya datang dari
 * database dan dari parameter request - artinya bisa saja tidak dikenal,
 * entah karena typo di admin atau karena baris lama dari versi lama
 * aplikasi.
 *
 * `isSupplierId()` menolak sebelum sempat dipakai, dan pesan errornya
 * menyebut daftar yang ada. Tanpa itu, id yang tidak dikenal akan
 * diteruskan jadi `undefined` dan meledak jauh dari penyebabnya - di
 * supplier yang salah, bukan di tempat yang salah wrote it.
 */

/**
 * Pabrik yang membuat klien baru.
 *
 * `new SupplierClient()` tiap kali dipanggil, bukan singleton: klien
 * tidak menyimpan state, dan mengembalikan objek yang sama membuat
 * cache internal salah terisolasi antar-pemanggil.
 */
type SupplierFactory = () => SupplierClient;

const factories = new Map<SupplierId, SupplierFactory>();

/**
 * Daftarkan klien supplier.
 *
 * Sengaja tidak diekspor ke kode selain file ini - pendaftaran supplier
 * baru harus lewat registry, bukan lewat `new` langsung di pemanggil. Kalau
 * ada yang membuat instance langsung, pemetaan di bawah tidak akan
 * mengetahuinya, dan `getSupplierClient` akan bilang supplier-nya tidak
 * dikenal padahal objeknya ada.
 */
export function registerSupplier(
  id: SupplierId,
  factory: SupplierFactory,
): void {
  if (!isSupplierId(id)) {
    throw new Error(
      `Supplier "${id}" tidak dikenal. Daftar yang sah: ${knownSupplierIds().join(", ")}.`,
    );
  }
  if (factories.has(id)) {
    throw new Error(`Supplier "${id}" sudah terdaftar.`);
  }
  factories.set(id, factory);
}

/**
 * Supplier yang punya pabrika terdaftar, apa pun status kredensialnya.
 */
export function registeredSupplierIds(): SupplierId[] {
  return [...factories.keys()].sort();
}

/**
 * Supplier yang siap dipakai: terdaftar DAN kredensialnya terisi.
 *
 * Bedanya dengan `registeredSupplierIds` penting untuk admin. Melostore
 * yang kredensialnya belum diisi tetap harus tampil di daftar - supaya
 * kelihatan ada yang perlu dikonfigurasi - tapi tidak boleh dipakai
 * untuk order.
 */
export function usableSupplierIds(): SupplierId[] {
  return registeredSupplierIds().filter((id) => getSupplierClient(id).isConfigured());
}

/**
 * Klien untuk supplier tertentu.
 *
 * Melempar kalau id-nya tidak dikenal, bukan mengembalikan `null`. Ini
 * dipanggil dari jalur order - jadi id yang tidak dikenal berarti ada bug
 * atau data rusak, dan diam-diam mengeksekusi lewat supplier default
 * akan jatuh ke supplier yang salah.
 */
export function getSupplierClient(id: SupplierId): SupplierClient {
  const factory = factories.get(id);
  if (!factory) {
    throw new Error(
      `Supplier "${id}" tidak terdaftar. Supplier yang tersedia: ${registeredSupplierIds().join(", ") || "(belum ada)"}.`,
    );
  }
  return factory();
}

/**
 * Klien yang siap dipakai, atau `null` kalau tidak.
 *
 * Untuk jalur yang boleh gagal dengan baik - cek saldo berkala, panel
 * admin, sinkronisasi katalog - di mana supplier yang belum terkonfigurasi
 * harus dilewati, bukan menghentikan seluruh operasi.
 */
export function tryGetSupplierClient(id: SupplierId): SupplierClient | null {
  const factory = factories.get(id);
  if (!factory) return null;
  const client = factory();
  return client.isConfigured() ? client : null;
}

/**
 * Semua klien yang siap dipakai.
 *
 * Dipakai admin untuk menampilkan saldo seluruh supplier sekaligus, dan
 * oleh sync katalog untuk memproses semua supplier dalam satu lintasan.
 */
export function usableSupplierClients(): SupplierClient[] {
  return registeredSupplierIds()
    .map(getSupplierClient)
    .filter((client) => client.isConfigured());
}

/** Hanya untuk pengujian: kosongkan registry tanpa memuat ulang modul. */
export function __resetSupplierRegistryForTests(): void {
  factories.clear();
}