/**
 * Helper murni untuk format dan parsing Telegram.
 *
 * Sengaja tanpa import apa pun — bukan `@/lib/*`, bukan `node:*`. Modul ini
 * dipanggil dari test runner (`node --test`) yang tidak bisa me-resolve alias
 * Next.js, dan dipakai juga oleh lapisan yang butuh tanpa efek samping:
 * `escapeTelegramHtml` tidak boleh menarik konfigurasi Supabase hanya untuk
 * Called out.
 */

export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Escape teks sebelum masuk `parse_mode: HTML`.
 *
 * Wajib untuk semua string dari database: label produk, pesan supplier, dan
 * nama game berasal dari luar. Satu karakter `<` saja sudah membuat Telegram
 * menolak seluruh pesan dengan 400 "can't parse entities", dan `&` yang tidak
 * di-escape bisa merusak tampilan.
 */
export function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Potong pesan agar di bawah batas Telegram, dengan penanda bahwa terpotong. */
export function truncateForTelegram(text: string) {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;

  const marker = "\n\n[pesan dipotong oleh batas Telegram]";
  return `${text.slice(0, TELEGRAM_TEXT_LIMIT - marker.length).trimEnd()}${marker}`;
}

/**
 * Ringkasan pesan untuk log: satu baris, dipotong. Dipakai supaya baris log
 * tetap bisa searched tanpa menyimpan isi penuh yang mungkin panjang.
 */
export function previewForLog(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

/**
 * Perintah bot yang diimplementasikan.
 *
 * Disimpan sebagai daftar, bukan hanya teks help, supaya `/help` tidak pernah
 * menampilkan perintah yang tidak ada di `runBotCommand`.
 */
export const TELEGRAM_BOT_COMMANDS = [
  { command: "/status", description: "ringkasan kesehatan operasi" },
  { command: "/saldo", description: "saldo Digiflazz terbaru" },
  { command: "/order NBH-...", description: "detail satu order" },
  { command: "/incident", description: "incident yang masih terbuka" },
  { command: "/retry-receipt NBH-...", description: "kirim ulang receipt order sukses" },
  { command: "/help", description: "daftar perintah ini" },
] as const;

export function telegramHelpText() {
  return [
    "Perintah yang tersedia:",
    ...TELEGRAM_BOT_COMMANDS.map((item) => `${item.command} — ${item.description}`),
  ].join("\n");
}

export type ParsedTelegramCommand = { command: string; argument: string };

/**
 * Pecah pesan teks menjadi perintah + argumen.
 *
 * Mengembalikan `null` kalau bukan perintah — webhook diam-diam mengabaikan
 * chat biasa, jadi `null` bukan error. Sufiks `@namabot` dibuang karena di grup
 * Telegram mengirim "/status@nambah_bot".
 */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.split("@")[0]?.toLowerCase() ?? "";
  if (!command) return null;

  return { command, argument: rest.join(" ") };
}

/**
 * Validasi bentuk order id sebelum dipakai sebagai filter query.
 *
 * Menolak input yang jelas bukan order id membuat query tidak pernah jalan
 * untuk input fullest dari stranger, dan pesan errornya lebih jelas.
 */
export function parseOrderId(argument: string) {
  const value = argument.trim().toUpperCase();
  return /^NBH-[A-Z0-9-]{4,40}$/.test(value) ? value : null;
}