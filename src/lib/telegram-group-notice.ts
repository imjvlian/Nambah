/**
 * Sapaan untuk grup yang belum terdaftar.
 *
 * Murni: tanpa I/O, tanpa Telegram, tanpa database. Supaya aturan
 * "pesan ini sudah pernah dikirim ke grup ini" bisa diuji tanpa
 * menyiapkan bot sungguhan.
 */

/**
 * Berapa kali sapaan dikirim ke satu grup, selamanya.
 *
 * SATU, bukan "beberapa kali". Kalau nilainya lebih dari satu, tiap
 * pesan baru di grup yang sama akan memicu balasan lagi - dan grup
 * yang salah tempat akanISIBLE, bukan diam, tapi kalau dibiarkan
 * tanpa batas berubah jadi spam yang membuat orang mematikan notifikasi.
 *
 * Satu kali cukup: sapaan itu hanya berguna sebagai penunjuk ke
 * tempat konfigurasinya, dan kalau operator belumuin dalam sejam
 * setelah mendengar, sapaan kedua tidak akan memperbaiki apa pun.
 */
export const UNREGISTERED_GROUP_NOTICE_LIMIT = 1;

/** Kunci dedupe yang stabil per grup, bukan per waktu. */
export function unregisteredGroupNoticeKey(chatId: string) {
  return `unregistered-group:${chatId}`;
}

/**
 * Daftar ID grup yang terdaftar.
 *
 * Dipisah dari route supaya aturan pemisahannya - koma, spasi, entah -
 * diuji sekali di sini, bukan ditebak ulang di webhook.
 */
export function parseAllowedGroupIds(raw: string | undefined | null) {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Apakah chat ini grup yang BOLEH dilayani bot.
 *
 * Chat pribadi selalu ditolak, meskipun ID-nya ada di daftar. Bot
 * harusnya hanya menjawab di grup yang memang ditunjuk operator;
 * membalas di DM membuka permukaan perintah yang tidak perlu ada.
 */
export function isAllowedGroupChat(
  chatId: string,
  chatType: string,
  allowedGroupIds: string[],
) {
  if (chatType !== "group" && chatType !== "supergroup") return false;
  return allowedGroupIds.includes(chatId);
}

/**
 * Pesan yang dikirim ke grup yang belum terdaftar.
 *
 * Menyertakan ID grup itu sendiri karena itu satu-satunya informasi
 * yang dibutuhkan operator untuk memperbaiki konfigurasi - dan
 * menyalin `-1001234567890` dari teks pesan jauh lebih cepat daripada
 * membacanya dari log.
 *
 * Tanpa `parse_mode`, jadi teksnya aman dari massageTelegram HTML.
 * Tanda hubung dan kurung siku tidak di-escape karena pesan ini dikirim
 * polos; mem-escape-nya akan membuat teks tampil dengan backslash.
 */
export function unregisteredGroupNotice(chatId: string, botUsername: string) {
  const who = botUsername ? `@${botUsername}` : "bot ini";

  return [
    `${who} belum diizinkan di grup ini.`,
    "",
    `ID grup ini: ${chatId}`,
    "",
    `Supaya ${who} bisa menjawab perintah di sini, admin perlu menambahkan:`,
    `TELEGRAM_ALLOWED_GROUP_IDS=${chatId}`,
    "",
    "Kalau alert juga ingin dikirim ke grup ini, isi juga:",
    `TELEGRAM_ADMIN_CHAT_ID=${chatId}`,
    "",
    "ID grup supergroup selalu diawali -100. Kalau ID di atas tidak diawali -100,",
    "grup ini kemungkinan grup basic - naikkan jadi supergroup supaya tidak berubah.",
  ].join("\n");
}