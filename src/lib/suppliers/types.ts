/**
 * Kontrak bersama semua supplier.
 *
 * TANPA IMPORT DARI MODUL LAIN - modul ini boleh mengimpor `@/lib/*`
 * hanya kalau modul itu benar-benar type-only. Test runner memanggilnya
 * langsung dengan `node --test`, yang tidak bisa me-resolve alias Next.js
 * di jalur runtime.
 *
 * KENAPA KONTRAK INI HANCUR
 *
 * Dua supplier tidak punya satu nama pun yang sama. Status di Digiflazz
 * adalah `"Sukses" | "Pending" | "Gagal"` dengan huruf awal kapital,
 * sementara Melostore memakai `"success" | "pending" | "failed"` huruf kecil.
 * Kalau interface mengikuti salah satu, supplier lain harus menerjemahkan
 * sendiri di setiap tempat - dan setiap tempat itu punya peluang lupa.
 *
 * Jadi kontrak ini menyimpan BAHASA SUPPLIER-nya, bukan bentuk data
 * mentahnya. Tiap `SupplierClient` yang menerjemahkan, semua yang di
 * atasnya (fulfillment, laporan, admin) hanya mengenal
 * bentuk di file ini.
 *
 * KENAPA TIDAK ADA ASAL-USUL IDENTITAS MELODAL
 *
 * `SupplierId` sengaja `string`, bukan union literal
 * `"digiflazz" | "melostore"`. Menambah union itu berarti mengedit file ini
 * setiap kali ada supplier ketiga, dan karena tipe ini tidak runtime-checked,
 * yang salah ketik di union tidak akan tertangkap `tsc` di tempat yang
 * memanggil - hanya di file ini.
 *
 * Yang menahan salah ketik adalah `isSupplierId()` di bawah: id yang tidak
 * dikenal ditolak saat runtime, di registry, sebelum sempat dipakai.
 */

/** Pengenal supplier. Selalu huruf kecil, tanpa spasi. */
export type SupplierId = string;

/** Pilihan Environment untuk eksekusi transaksi. */
export type SupplierEnvironment = "sandbox" | "live";

/**
 * Status transaksi setelah dinormalisasi.
 *
 * `pending` berarti "diterima, belum tahu hasilnya" - BUKAN "gagal".
 * Pemisahan ini penting: order yang masih `pending` masih mungkin berhasil,
 * dan memperlakukannya sebagai gagal akan membakar reputasi supplier.
 */
export type SupplierTransactionStatus = "success" | "pending" | "failed";

/**
 * Satu SKU dari katalog supplier.
 *
 * `stock: null` berarti TIDAK DIKETAHUI, dan itu berbeda dari `0`.
 * Melostore tidak mengirim jumlah stok sama sekali di price-list-nya,
 * sedangkan Digiflazz mengirimnya. Kalau `null` diperlakukan sebagai nol,
 * selection akan menolak semua SKU Melostore tanpa alasan - dan tidak ada
 * yang bisa diagnosingnya dari log.
 */
export type SupplierQuote = {
  supplierId: SupplierId;
  /** SKU milik supplier (bukan id produk Nambah). */
  sku: string;
  /** Modal dalam rupiah, bilangan bulat. */
  cost: number;
  stock: number | null;
};

/** Saldo yang tersedia untuk dipakai, sudah dikurangi yang dipesan. */
export type SupplierBalance = {
  supplierId: SupplierId;
  /** Saldo total di sisi supplier. */
  balance: number;
  /** Bagian saldo yang sudah dikunci order yang belum selesai. */
  reserved: number;
};

export type SupplierTransactionInput = {
  /**
   * Referensi unik order. Dipakai supplier sebagai idempotency key:
   * request dengan ref yang sama mengembalikan transaksi yang sama.
   *
   * Untuk Melostore ini `buyer_trx_id`; untuk Digiflazz ini `ref_id`.
   */
  requestRef: string;
  sku: string;
  /** ID pemain / email yang jadi tujuan pengiriman. */
  target: string;
  /** Server atau zona, kalau produknya butuh. */
  zone: string | null;
  /** Batas harga yang boleh dipotong supplier. */
  maxPrice: number;
  environment: SupplierEnvironment;
  /** Field tambahan per produk, kunci = `key` dari inquiry form supplier. */
  additionalData?: Record<string, string>;
};

export type SupplierTransactionResult = {
  status: SupplierTransactionStatus;
  /** ID transaksi di sisi supplier, untuk cek status dan rekonsiliasi. */
  transactionId: string | null;
  /** Nominal yang benar-benar ditahan supplier, bukan harga katalog. */
  charged: number;
  serialNumber: string | null;
  /** Alasan kegagalan dalam kalimat supplier. Boleh `null` kalau sukses. */
  message: string;
  /** Kode kegagalan mesin-terbaca, mis. `MAX_PRICE_TOO_LOW`. */
  errorCode: string | null;
};

/**
 * Status yang diteruskan ke order Nambah.
 *
 * Berpisah dari `SupplierTransactionStatus` karena "supplier bilang
 * pending" dan "order Nambah masih menunggu" bukan hal yang sama. Order
 * punya statusnya sendiri yang jauh lebih halus (termasuk
 * `pending_merchant`, yang tidak ada di supplier).
 */
export type SupplierWebhookEvent = {
  /** Ref order yang dikembalikan supplier, untuk pencocokan. */
  requestRef: string;
  status: SupplierTransactionStatus;
  transactionId: string | null;
  serialNumber: string | null;
  charged: number | null;
  message: string | null;
  errorCode: string | null;
  /** Event Aksi yang perlu campur tangan (mis. 2FA). Boleh null. */
  requiresAction: boolean;
  /** Kunci idempotensi untuk dedup callback yang berulang. */
  eventKey: string;
};

export interface SupplierClient {
  readonly id: SupplierId;

  /** Nama untuk ditampilkan di admin. */
  readonly label: string;

  /** False kalau kredensial belum diisi di environment. */
  isConfigured(): boolean;

  /** Katalog lengkap. Implementasi boleh meng-cache sendiri. */
  fetchQuotes(): Promise<SupplierQuote[]>;

  fetchBalance(): Promise<number>;

  runTransaction(
    input: SupplierTransactionInput,
  ): Promise<SupplierTransactionResult>;

  /** Verifikasi tanda tangan callback terhadap raw body. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;

  /**
   * Ubah payload callback menjadi bentuk di atas.
   *
   * Harus mengembalikan `null` untuk payload yang tidak dikenali - bukan
   * melempar error. Callback yang tidak bisa diparse HARUS tetap dibalas
   * 200 supaya supplier berhenti mengirim ulang.
   */
  parseWebhook(rawBody: string): SupplierWebhookEvent | null;
}

/**
 * Error dari sisi supplier.
 *
 * `retryable` membedakan "coba lagi" dari "jangan ulangi" - yang kedua
 * harus langsung mengubah status order supaya pembeli tidak menunggu.
 */
export class SupplierError extends Error {
  readonly supplierId: SupplierId;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(
    supplierId: SupplierId,
    message: string,
    options?: { code?: string | null; retryable?: boolean },
  ) {
    super(message);
    this.name = "SupplierError";
    this.supplierId = supplierId;
    this.code = options?.code ?? null;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * Normalisasi status supplier ke bentuk bersama.
 *
 * Mengembalikan `null` kalau statusnya benar-benar tidak dikenal.
 *
 * `null` BUKAN berarti "gagal". Status yang tak dikenal - baik karena
 * supplier menambah nilai baru, maupun karena responsnya rusak - harus
 * diperlakukan sebagai `pending`, supaya order bisa dicek ulang lewat
 * endpoint status. Menebaknya sebagai `failed` akan membakar reputasi
 * supplier, dan uang pembeli belum tentu kembali.
 */
export function normalizeSupplierStatus(
  raw: string | null | undefined,
): SupplierTransactionStatus | null {
  if (typeof raw !== "string") return null;

  const value = raw.trim().toLowerCase();
  if (!value) return null;

  switch (value) {
    case "success":
    case "sukses":
    case "berhasil":
    case "completed":
    case "complete":
    case "delivered":
      return "success";

    case "pending":
    case "processing":
    case "in_progress":
    case "inprogress":
    case "accepted":
    case "queued":
    case "waiting":
      return "pending";

    case "failed":
    case "gagal":
    case "fail":
    case "error":
    case "rejected":
    case "canceled":
    case "cancelled":
    case "refunded":
      return "failed";

    default:
      return null;
  }
}

/**
 * Ubah angka dari supplier menjadi rupiah bulat.
 *
 * Beberapa supplier mengirim harga sebagai string ("1500"), sebagian sebagai
 * angka. `Number("")` adalah `0`, dan `Number("1.500")` adalah `NaN` - dua
 * jebakan yang berbeda, jadi keduanya diperiksa terpisah.
 *
 * Mengembalikan `null` kalau tidak bisa dibaca, dan pemanggil yang
 * memutuskan - bukan fungsi ini yang mengarang angka.
 */
export function toSupplierAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }
  return null;
}

/**
 * Baca stok dari supplier.
 *
 * Mengembalikan `null` kalau tidak ada atau tidak terbaca - yang berarti
 * "tidak diketahui", bukan "habis". Melostore tidak mengirim stok di
 * price-list, jadi `null` akan menjadi nilai yang paling sering muncul,
 * dan itu memang nilai yang benar.
 */
export function toSupplierStock(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  const parsed = toSupplierAmount(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/** Supplier yang dikenal sistem ini. */
const KNOWN_SUPPLIER_IDS = new Set(["digiflazz", "melostore"]);

/**
 * Periksa apakah id itu supplier yang dikenal.
 *
 * Dipakai registry sebelum mengembalikan klien, supaya id dari database
 * yang salah ketik ditolak di sini - bukan diteruskan jadi `undefined`
 * yang baru meledak di tempat yang jauh dari penyebabnya.
 */
export function isSupplierId(value: unknown): value is SupplierId {
  return typeof value === "string" && KNOWN_SUPPLIER_IDS.has(value);
}

/** Daftar id supplier yang dikenal, untuk validasi dan UI admin. */
export function knownSupplierIds(): SupplierId[] {
  return [...KNOWN_SUPPLIER_IDS];
}