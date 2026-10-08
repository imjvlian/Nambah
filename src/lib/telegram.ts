import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";
import {
  escapeTelegramHtml,
  previewForLog,
  truncateForTelegram,
} from "@/lib/telegram-format";

/**
 * Lapisan pengiriman Telegram.
 *
 * Semua pesan keluar lewat sini, termasuk pesan berformat HTML dan antrean
 * (`enqueueTelegramMessage`). Alasannya dua:
 *
 * 1. Telegram membatasi ~1 pesan per detik per chat. Kalau alert fulfilment
 *    langsung dikirim di dalam webhook, tiga order gagal beruntun akan kena
 *    rate limit dan alert-nya hilang. Jadi event produksi masuk antrean dulu,
 *    lalu worker mengencernya satu per satu.
 * 2. Setiap pengiriman dicatat di `telegram_delivery_log` dengan
 *    `dedupe_key` unik, jadi webhook yang dikirim berulang tidak menghasilkan
 *    pesan berulang dan kegagalan bisa ditelusuri beberapa hari kemudian.
 */

const SEND_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

// Re-export supaya pemanggil cukup mengimpor dari satu modul.
export { escapeTelegramHtml };

export type TelegramDeliveryStatus = "sent" | "failed" | "skipped" | "pending";

export type TelegramDeliveryRow = {
  id: number;
  kind: string;
  status: TelegramDeliveryStatus;
  dedupe_key: string;
  chat_id: string | null;
  message_preview: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  attempts: number | string;
  created_at: string;
};

export type TelegramMessageOptions = {
  /**
   * Format markup Telegram. Default `undefined` = teks polos, dipakai agar
   * pemanggil lama (saldo, incident) tidak ikut berubah perilaku.
   */
  parseMode?: "HTML";
  /** Tombol inline, mis. membuka halaman admin. */
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
  /** Dedup key untuk antrean. Wajib kalau pesan di-enqueue. */
  dedupeKey?: string;
  /** Kategori untuk tabel log. */
  kind?: string;
};

export function isTelegramConfigured() {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_ADMIN_CHAT_ID?.trim(),
  );
}

function telegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
}

function telegramAdminChatId() {
  return process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";
}

/**
 * Catatan: `escapeTelegramHtml`, `truncateForTelegram`, dan `previewForLog`
 * sekarang tinggal di `@/lib/telegram-format` supaya bisa diuji tanpa menarik
 * konfigurasi database.
 */
type SendOutcome =
  | { ok: true }
  | { ok: false; error: string; retryable: boolean };

async function callTelegramApi(
  method: string,
  body: Record<string, unknown>,
): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${telegramBotToken()}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    const raw = await response.text();
    if (response.ok) return { ok: true };

    return {
      ok: false,
      error: `${method} failed (${response.status}): ${raw.slice(0, 300)}`,
      // 429 = kena rate limit, 5xx = sisi Telegram. Keduanya layak dicoba lagi.
      retryable: response.status === 429 || response.status >= 500,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${method} threw: ${message}`, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kirim pesan langsung dengan retry singkat.
 *
 * Retry hanya untuk error 429/5xx dan maksimal `MAX_ATTEMPTS`. Tidak untuk
 * 400 — kalau format atau chat id salah, mengulang hanya memperpanjang
 * kegagalan.
 */
export async function sendTelegramMessage(
  text: string,
  options?: TelegramMessageOptions,
) {
  const chatId = telegramAdminChatId();

  if (!telegramBotToken() || !chatId) {
    await recordDelivery({
      kind: options?.kind ?? "general",
      dedupeKey: options?.dedupeKey ?? `unconfigured:${Date.now()}`,
      status: "skipped",
      text,
      error: "not-configured",
    });
    return { sent: false as const, reason: "not-configured" as const };
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: truncateForTelegram(text),
    disable_web_page_preview: true,
  };
  if (options?.parseMode) payload.parse_mode = options.parseMode;
  if (options?.replyMarkup) payload.reply_markup = options.replyMarkup;

  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const outcome = await callTelegramApi("sendMessage", payload);

    if (outcome.ok) {
      await recordDelivery({
        kind: options?.kind ?? "general",
        dedupeKey: options?.dedupeKey ?? `sent:${Date.now()}`,
        status: "sent",
        text,
        attempts: attempt,
      });
      return { sent: true as const };
    }

    lastError = outcome.error;
    if (!outcome.retryable) break;
    // Backoff linear: 1s lalu 2s. Cukup untuk 429 tanpa menahan worker lama.
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }

  await recordDelivery({
    kind: options?.kind ?? "general",
    dedupeKey: options?.dedupeKey ?? `failed:${Date.now()}`,
    status: "failed",
    text,
    attempts: MAX_ATTEMPTS,
    error: lastError,
  });

  throw new Error(lastError);
}

/**
 * Masukkan pesan ke antrean alih-alih mengirim langsung.
 *
 * Dipakai untuk event yang bisa terjadi beruntun (fulfillment gagal, receipt
 * gagal). `onConflict: ignore` membuat pemanggilan berulang menjadi no-op,
 * jadi webhook yang delivers dua kali tidak menghasilkan dua antrean entry.
 */
export async function enqueueTelegramMessage(
  text: string,
  options: { kind: string; dedupeKey: string; payload?: Record<string, unknown> },
) {
  if (!isTelegramConfigured()) {
    return { queued: false as const, reason: "not-configured" as const };
  }

  await supabaseInsert("telegram_delivery_log", {
    kind: options.kind,
    status: "pending",
    dedupe_key: options.dedupeKey,
    chat_id: telegramAdminChatId(),
    message_preview: previewForLog(text),
    // Teks penuh ikut disimpan: `message_preview` sudah diratakan dan dipotong
    // untuk keperluan log, jadi tidak bisa dipakai untuk mengirim ulang.
    payload: { text, ...(options.payload ?? {}) },
    attempts: 0,
    updated_at: new Date().toISOString(),
  }).catch((error: unknown) => {
    // Pelanggaran unique = pesan ini sudah ada di antrean. Itu hasil yang
    // diinginkan, bukan error.
    if (isUniqueViolation(error)) return;
    throw error;
  });

  return { queued: true as const };
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && error.message.includes("23505");
}

async function recordDelivery(input: {
  kind: string;
  dedupeKey: string;
  status: TelegramDeliveryStatus;
  text: string;
  attempts?: number;
  error?: string;
}) {
  const now = new Date().toISOString();

  try {
    await supabaseInsert("telegram_delivery_log", {
      kind: input.kind,
      status: input.status,
      dedupe_key: input.dedupeKey,
      chat_id: telegramAdminChatId() || null,
      message_preview: previewForLog(input.text),
      payload: {},
      attempts: input.attempts ?? 1,
      error: input.error ?? null,
      updated_at: now,
    });
  } catch (error) {
    // Log Delivery tidak boleh menjatuhkan operasi bisnisnya. Kalau tabelnya
    // belum ada (migrasi 029 belum dijalankan), kegagalannya hanya ke log.
    console.error("Telegram delivery log insert failed", error);
  }
}

/** Pesan antrean yang menunggu dikirim, paling lama dulu. */
export async function listPendingTelegramMessages(limit = 10) {
  return supabaseSelect<TelegramDeliveryRow>("telegram_delivery_log", {
    select: "id,kind,status,dedupe_key,chat_id,message_preview,payload,error,attempts,created_at",
    filters: { status: "eq.pending" },
    order: "created_at.asc",
    limit,
  });
}

export async function markTelegramDelivery(
  id: number,
  status: TelegramDeliveryStatus,
  extra?: { error?: string; attempts?: number },
) {
  await supabaseUpdate(
    "telegram_delivery_log",
    {
      status,
      error: extra?.error ?? null,
      attempts: extra?.attempts ?? null,
      updated_at: new Date().toISOString(),
    },
    { filters: { id: `eq.${id}` } },
  );
}

/**
 * Kirim antrean satu per satu dengan jeda.
 *
 * Jeda 1,1 detik dipilih karena itu batas Telegram per chat (1 pesan/detik).
 * Mengirim paralel akan kena 429 dan pesannya hilang.
 *
 * Dipanggil dari timer tiap menit. Kalau antrean tumbuh lebih cepat dari
 * kapasitas timer, naikkan `limit` atau tambahkan instance timer — jangan
 * mengirim paralel.
 */
export async function drainTelegramQueue(
  limit = 20,
  options?: { spacingMs?: number },
) {
  const spacingMs = options?.spacingMs ?? 1_100;
  const pending = await listPendingTelegramMessages(limit);
  const summary = { attempted: 0, sent: 0, failed: 0 };

  for (const row of pending) {
    summary.attempted += 1;

    // `message_preview` tidak bisa dipakai untuk mengirim ulang: teksnya sudah
    // diratakan dan dipotong untuk log. Baris `pending` selalu dibuat oleh
    // `enqueueTelegramMessage`, yang menyimpan teks penuh di `payload.text`.
    const text = typeof row.payload?.text === "string" ? row.payload.text : null;

    if (!text) {
      await markTelegramDelivery(row.id, "failed", {
        error: "payload.text hilang — tidak bisa dikirim ulang.",
      });
      summary.failed += 1;
      continue;
    }

    const outcome = await callTelegramApi("sendMessage", {
      chat_id: row.chat_id || telegramAdminChatId(),
      text: truncateForTelegram(text),
      disable_web_page_preview: true,
      parse_mode: "HTML",
    });

    if (outcome.ok) {
      await markTelegramDelivery(row.id, "sent", {
        attempts: Number(row.attempts ?? 0) + 1,
      });
      summary.sent += 1;
    } else {
      await markTelegramDelivery(row.id, "failed", {
        error: outcome.error.slice(0, 500),
        attempts: Number(row.attempts ?? 0) + 1,
      });
      summary.failed += 1;
    }

    if (summary.attempted < pending.length) {
      await new Promise((resolve) => setTimeout(resolve, spacingMs));
    }
  }

  return summary;
}