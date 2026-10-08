import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import { parseTelegramCommand } from "@/lib/telegram-format";
import { runBotCommand } from "@/lib/telegram-commands";
import { supabaseInsert, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Webhook masuk dari Telegram.
 *
 * Empat lapis guard, dari yang paling murah:
 *
 * 1. Secret token. Telegram mengirimnya sebagai header
 *    `X-Telegram-Bot-Api-Secret-Token`, dan header itu sudah diverifikasi di
 *    sisi Telegram — jadi tanpa ini siapa pun bisa menyuruh bot.
 * 2. Allowlist chat. Hanya `TELEGRAM_ADMIN_CHAT_ID` yang boleh memberi perintah.
 *    Grup yang menambahkan bot tidak otomatis boleh.
 * 3. `update_id` harus berupa angka.
 * 4. Dedupe `update_id`. Telegram mengirim ulang update yang belum dijawab dan
 *    polling `getUpdates` bisa diputar ulang, jadi satu ketikan tidak boleh
 *    menjalankan `/retry-receipt` dua kali.
 */

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number | string; type: string };
    from?: { username?: string };
  };
};

function safeEqual(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function readHeader(request: Request, name: string) {
  return request.headers.get(name) ?? "";
}

function isAllowedChat(chatId: string) {
  const configured = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";
  return Boolean(configured) && chatId === configured;
}

/**
 * Dedupe `update_id`.
 *
 * Sengaja di-tolerant: kalau tabelnya belum ada (migrasi belum dijalankan),
 * hasilnya dianggap "belum pernah diproses" dan perintah tetap jalan. Bot
 * menerima satu update dua kali bukan masalah besar; webhook mati total jauh
 * lebih merepotkan.
 */
async function alreadyProcessed(updateId: number) {
  try {
    const seen = await supabaseSelect<{ update_id: number }>("telegram_updates", {
      select: "update_id",
      filters: { update_id: `eq.${updateId}` },
      limit: 1,
    });
    return seen.length > 0;
  } catch {
    return false;
  }
}

async function rememberUpdate(updateId: number) {
  try {
    await supabaseInsert("telegram_updates", { update_id: updateId });
  } catch (error) {
    // 23505 = duplikat (bagus), 404 = tabel belum ada. Keduanya bukan alasan
    // untuk menggagalkan balasan.
    console.error(`Failed to remember telegram update ${updateId}`, error);
  }
}

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return Response.json({ error: "Bot Telegram belum dikonfigurasi." }, { status: 503 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return Response.json(
      { error: "TELEGRAM_WEBHOOK_SECRET belum dikonfigurasi — webhook ditolak." },
      { status: 503 },
    );
  }

  if (!safeEqual(readHeader(request, "x-telegram-bot-api-secret-token"), secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "Body bukan JSON." }, { status: 400 });
  }

  const message = update.message;
  const text = message?.text?.trim();

  // Group dan channel tetap bisa chatting, tapi hanya chat admin yang boleh
  // menjalankan perintah.
  if (!message || !text || !isAllowedChat(String(message.chat.id))) {
    return Response.json({ ok: true, ignored: true });
  }

  const parsed = parseTelegramCommand(text);
  if (!parsed) {
    return Response.json({ ok: true, ignored: "bukan-perintah" });
  }

  if (await alreadyProcessed(update.update_id)) {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    const result = await runBotCommand({
      command: parsed.command,
      argument: parsed.argument,
      chatId: String(message.chat.id),
    });

    await sendTelegramMessage(result.text, {
      kind: "command",
      parseMode: "HTML",
    });

    await rememberUpdate(update.update_id);

    return Response.json({
      ok: true,
      command: parsed.command,
      mutating: result.mutating ?? false,
    });
  } catch (error) {
    console.error(`Telegram command ${parsed.command} failed`, error);

    // Error tetap dibalas supaya Telegram tidak mengirim ulang update yang
    // sama dalam 24 jam.
    await sendTelegramMessage(
      `Perintah ${parsed.command} gagal: ${
        error instanceof Error ? error.message : "error tidak diketahui"
      }`,
      { kind: "command" },
    ).catch(() => undefined);

    // 200: perintah gagal, transport-nya succeed. Kalau 5xx, Telegram akan
    // mencoba mengirim ulang update yang sama.
    return Response.json({ ok: false, error: "Perintah gagal dijalankan." });
  }
}

/**
 * Telegram hanya mengirim POST. GET tetap dijawab supaya monitor tidak
 * menganggap endpoint mati, tapi isinya jujur menyatakan belum dipakai.
 */
export async function GET() {
  return Response.json({
    ok: false,
    error: "Webhook Telegram hanya menerima POST.",
    hint: "Daftarkan lewat scripts/telegram-set-webhook.mjs",
  });
}