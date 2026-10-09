/**
 * Label status order untuk UI.
 *
 * Satu sumber untuk dua dashboard. Sebelumnya `/account` memakai bahasa
 * Indonesia ("Menunggu pembayaran", "Berhasil") sementara `/admin` memakai
 * bahasa Inggris ("Pending payment", "Success") — dua nama berbeda untuk hal
 * yang sama, jadi user dan operator bicara bahasa yang berlainan.
 *
 * `STATUS_LABEL` dipakai untuk teks yang tampil. `STATUS_TONE` memberi kelompok
 * warna supaya tidak perlu menulis `status-xxx` di mana-mana, dan tidak perlu
 * menambah kelas CSS baru setiap kali ada status baru.
 *
 * PENTING: modul ini TIDAK mengubah data. Order tetap memakai nilai `status`
 * yang sama di database; yang berubah hanya cara menampilkannya.
 */

/** Urutan status dari yang paling butuh perhatian ke yang selesai. */
export const ORDER_STATUS_ORDER = [
  "failed",
  "pending_payment",
  "processing",
  "paid",
  "success",
  "refunded",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUS_ORDER)[number];

/** Label Bahasa Indonesia. Satu-satunya tempat teks ini ditulis. */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Pembayaran diterima",
  processing: "Sedang diproses",
  success: "Berhasil",
  failed: "Gagal",
  refunded: "Dikembalikan",
  cancelled: "Dibatalkan",
};

/**
 * Kelompok warna per status.
 *
 * Dipisah dari `STATUS_LABEL` karena satu status bisa punya beberapa tampilan:
 * label untuk daftar, dan penjelasan panjang untuk halaman detail.
 */
export const STATUS_TONE: Readonly<Record<string, "wait" | "busy" | "done" | "bad">> = {
  pending_payment: "wait",
  paid: "busy",
  processing: "busy",
  success: "done",
  refunded: "wait",
  failed: "bad",
  cancelled: "wait",
};

/**
 * Status yang belum selesai — order ini butuh sesuatu dari user atau dari
 * operator. Dipakai untuk memisahkan "yang perlu dicermati" dari riwayat.
 */
export const OPEN_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "pending_payment",
  "paid",
  "processing",
]);

/** Label status, dengan fallback ke nilai aslinya kalau status tak dikenal. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * Penjelasan singkat status, atau string kosong kalau status tak dikenal.
 *
 * Tanpa ini user hanya melihat "Sedang diproses" dan tidak tahu apakah itu
 * wajar atau tanda ada yang salah.
 */
export function statusHint(status: string): string {
  return STATUS_HINT[status] ?? "";
}

/** Kelompok warna status, default `wait` untuk status tak dikenal. */
export function statusTone(status: string): "wait" | "busy" | "done" | "bad" {
  return STATUS_TONE[status] ?? "wait";
}

/**
 * Penjelasan singkat untuk status, dalam bahasa sehari-hari.
 *
 * Tanpa ini user hanya melihat "Sedang diproses" dan tidak tahu apakah itu
 * normal atau tanda ada yang salah.
 */
export const STATUS_HINT: Readonly<Record<string, string>> = {
  pending_payment: "Pesanan menunggu pembayaran kamu.",
  paid: "Pembayaran masuk, menunggu diproses.",
  processing: "Sedang dikirim ke game. Biasanya kurang dari 5 menit.",
  success: "Sudah masuk ke akun game.",
  failed: "Pesanan gagal. Kalau kamu sudah membayar, hubungi kami.",
  refunded: "Dana sudah dikembalikan.",
  cancelled: "Pesanan dibatalkan.",
};

/** Status ini perlu disorot, jadi muncul paling atas. */
export function isOpenOrder(status: string): boolean {
  return OPEN_ORDER_STATUSES.has(status);
}

/**
 * Selisih waktu ringkas dalam bahasa Indonesia: "baru saja", "3 menit lalu".
 *
 * Dipakai untuk memberi konteks pada order yang belum selesai. Tanpa ini
 * "Sedang diproses" tidak bisa dinilai — 3 menit itu wajar, 3 jam itu tidak.
 */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;
  return `${Math.floor(months / 12)} tahun lalu`;
}

/**
 * Berapa lama order sudah berjalan, untuk yang belum selesai.
 *
 * `null` kalau order-nya sudah selesai — waktu selesai tidak relevan di sana.
 */
export function elapsedSince(value: string): string | null {
  const text = relativeTime(value);
  return text ? text.replace(" lalu", "") : null;
}
