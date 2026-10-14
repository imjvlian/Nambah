import { escapeTelegramHtml } from "@/lib/telegram-format";
import { gameDisplayNames } from "@/lib/game-display-name";

/**
 * Isi pesan alert fulfilment - bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `telegram-alerts.ts` karena modul latter mengimpor
 * `server-only` dan Supabase, sedangkan isi pesan justru tempat yang
 * paling sering disalahbaca: pesan yang terlihat benar padahal
 * brand-nya salah akan membuat admin mengira ordernya untuk game lain.
 *
 * KENAPA BRAND DIAMBIL DARI `games`, BUKAN DARI `products.label`
 *
 * `products.label` adalah nama paket, dan paket Melostore sering
 * cuma "128 Diamond" - tanpa menyebut game-nya. Brand ada di
 * `games.name`, yang diisi dari brand SKU supplier, dan itulah yang
 * dipetakan ke game lewat auto-create brand. Menampilkan label
 * paket saja membuat pesan Melostore tidak bisa dibedakan dari
 * Digiflazz kalau keduanya memakai nama paket yang sama.
 *
 * Override nama tampilan (mis. `lifeafter-credits` -> "LifeAfter")
 * diterapkan lewat `gameDisplayNames`, sama seperti laporan
 * transaksi, supaya nama yang sama muncul di semua tempat.
 */

/** Baris `games` seperlunya untuk membentuk brand. */
export type AlertGameRow = {
  id: string;
  name: string | null;
  short_name: string | null;
};

/** Data transaksi supplier seperlunya untuk pesan. */
export type AlertTransaction = {
  supplier_id: string | null;
  supplier_sku: string | null;
  serial_number: string | null;
  message: string | null;
} | null;

/**
 * Label supplier yang enak dibaca admin.
 *
 * `supplier_id` disimpan apa adanya di database (`melostore`,
 * `digiflazz`), jadi pemetaan ke nama tampilan dilakukan di satu
 * tempat. Supplier yang belum dikenali tetap ditampilkan apa adanya
 * dalam huruf kapital - menyembunyikannya jadi "-" membuat order
 * dari supplier baru terlihat sama dengan order tanpa supplier.
 */
export function supplierLabel(supplierId: string | null | undefined) {
  const raw = (supplierId ?? "").trim();
  if (!raw) return "-";

  const known: Record<string, string> = {
    melostore: "Melostore",
    digiflazz: "Digiflazz",
  };

  const match = known[raw.toLowerCase()];
  if (match) return match;

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Brand yang tampil di pesan.
 *
 * Mengembalikan fallback kalau game tidak punya nama - `fallback`
 * biasanya `product_id`, supaya baris tetap punya isi dan pesan
 * tidak berlubang di tengah.
 */
export function brandLabel(game: AlertGameRow | undefined | null, fallback: string) {
  if (!game) return fallback;

  const display = gameDisplayNames(game.id, {
    name: game.name ?? "",
    shortName: game.short_name ?? "",
  });

  return display.name.trim() || fallback;
}

function rupiah(value: number | string) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/** Baris "Supplier" yang memuat nama supplier DAN SKU-nya. */
function supplierLines(transaction: AlertTransaction) {
  const label = supplierLabel(transaction?.supplier_id);
  const sku = transaction?.supplier_sku?.trim();

  return [`Supplier: ${escapeTelegramHtml(label)}`]
    .concat(sku ? [`SKU supplier: ${escapeTelegramHtml(sku)}`] : []);
}

/** Pesan fulfilment sukses. */
export function fulfillmentSuccessText(input: {
  orderId: string;
  brand: string;
  productLabel: string;
  serialNumber: string;
  transaction: AlertTransaction;
  sellingPrice: number | string;
}) {
  return [
    "<b>Fulfillment SUKSES</b>",
    `Order <code>${escapeTelegramHtml(input.orderId)}</code>`,
    `Brand game: ${escapeTelegramHtml(input.brand)}`,
    `Produk: ${escapeTelegramHtml(input.productLabel)}`,
    ...supplierLines(input.transaction),
    `SN: <code>${escapeTelegramHtml(input.serialNumber.trim())}</code>`,
    `Dibayar: ${escapeTelegramHtml(rupiah(input.sellingPrice))}`,
  ].join("\n");
}

/** Pesan fulfilment gagal. */
export function fulfillmentFailedText(input: {
  orderId: string;
  brand: string;
  productLabel: string;
  transaction: AlertTransaction;
  sellingPrice: number | string;
  supplierCost: number | string;
}) {
  const reason =
    input.transaction?.message?.trim() || "Tanpa pesan dari supplier.";

  return [
    "<b>Fulfillment GAGAL</b>",
    `Order <code>${escapeTelegramHtml(input.orderId)}</code>`,
    `Brand game: ${escapeTelegramHtml(input.brand)}`,
    `Produk: ${escapeTelegramHtml(input.productLabel)}`,
    ...supplierLines(input.transaction),
    `Alasan: ${escapeTelegramHtml(reason)}`,
    `Dibayar: ${escapeTelegramHtml(rupiah(input.sellingPrice))}`,
    `Modal: ${escapeTelegramHtml(rupiah(input.supplierCost))}`,
  ].join("\n");
}