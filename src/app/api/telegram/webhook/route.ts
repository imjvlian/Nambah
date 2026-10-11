import {
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";
import {
  isAllowedGroupChat,
  parseAllowedGroupIds,
  UNREGISTERED_GROUP_NOTICE_LIMIT,
  unregisteredGroupNotice,
  unregisteredGroupNoticeKey,
} from "@/lib/telegram-group-notice";
import { parseTelegramCommand } from "@/lib/telegram-format";
import { runBotCommand } from "@/lib/telegram-commands";
import {
  supabaseInsert,
  supabaseSelect,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: {
      id: number | string;
      type: string;
    };
    from?: {
      username?: string;
    };
  };
};

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

function readHeader(request: Request, name: string): string {
  return request.headers.get(name) ?? "";
}

/**
 * Sudah pernah menyapa grup ini?
 *
 * `telegram_delivery_log` dipakai karena sudah punya unique di
 * `dedupe_key`, jadi dua pesan webhook yang datang bersamaan tidak
 * bisa mengirim sapaan dua kali. Tanpa itu, grup yang salah tempat
 * akan menerima pesan yang sama setiap kali ada yang mengetik di sana.
 */
async function alreadyNotifiedGroup(chatId: string): Promise<boolean> {
  const key = unregisteredGroupNoticeKey(chatId);
  const rows = await supabaseSelect("telegram_delivery_log", {
    select: "dedupe_key",
    filters: { dedupe_key: `eq.${key}` },
    limit: UNREGISTERED_GROUP_NOTICE_LIMIT,
  });

  return Boolean(rows?.length);
}

/**
 * Kirim sapaan ke grup yang belum terdaftar, sekali saja seumur hidup.
 *
 * Kegagalan di sini TIDAK boleh menggagalkan webhook. Kalau `sendMessage`
 * melempar, responsnya tetap 200 dengan `ignored` - yang gagal bukan
 * perintah, dan Telegram akan mengirim update-nya lagi kalau webhook
 * membalas error.
 *
 * Kenapa errornya ditelan: kalau webhook membalas 500 untuk grup yang
 * tidak bisa ditulisi, Telegram mengirim ulang update-nya, dan setiap
 * percobaan ulang itu memanggil fungsi yang sama lagi. Itu retry loop
 * yang membebani bot tanpa pernah selesai.
 *
 * Respons tetap 200 karena memang tidak ada yang perlu dijalankan dari
 * grup yang belum terdaftar.
 */
async function notifyUnregisteredGroup(chatId: string): Promise<void> {
  try {
    if (await alreadyNotifiedGroup(chatId)) return;

    await sendTelegramMessage(unregisteredGroupNotice(chatId, botNameFromToken()), {
      kind: "unregistered-group",
      // Kunci tetap per grup, bukan per waktu: tanpa itu, setiap pesan
      // baru akan mengirim ulang sapaan yang sama.
      dedupeKey: unregisteredGroupNoticeKey(chatId),
      chatId,
    });
  } catch (error) {
    console.error(
      `[Telegram Webhook] Gagal menyapa grup ${chatId}:`,
      error,
    );
  }
}

function botNameFromToken(): string {
  /*
   * Format token: <id numerik>:<secret>. Nama pengguna bot tidak ada di
   * sini, jadi yang bisa diambil hanya id numeriknya - itu sudah cukup
   * untuk penyebutan, dan tidak perlu panggilan API tambahan di jalur
   * webhook yang sudah harus dijawab dalam 30 detik.
   */
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const id = token.split(":")[0] ?? "";
  return /^\d+$/.test(id) ? id : "";
}

async function alreadyProcessed(updateId: number): Promise<boolean> {
  const result = await supabaseSelect("telegram_updates", {
    select: "update_id",
    filters: {
      update_id: `eq.${updateId}`,
    },
    limit: 1,
  });

  return Boolean(result?.length);
}

async function rememberUpdate(updateId: number): Promise<void> {
  await supabaseInsert("telegram_updates", {
    update_id: updateId,
  });
}

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return Response.json(
      { ok: false, error: "Konfigurasi Telegram belum lengkap." },
      { status: 503 },
    );
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return Response.json(
      { ok: false, error: "TELEGRAM_WEBHOOK_SECRET belum diatur." },
      { status: 503 },
    );
  }

  const receivedSecret = readHeader(
    request,
    "x-telegram-bot-api-secret-token",
  );
  if (!safeEqual(receivedSecret, secret)) {
    return Response.json(
      { ok: false, error: "Secret webhook tidak valid." },
      { status: 401 },
    );
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json(
      { ok: false, error: "Payload JSON tidak valid." },
      { status: 400 },
    );
  }

  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) {
    return Response.json({ ok: true, ignored: true });
  }

  // Use the chat ID from the incoming Telegram update as the reply destination.
  const chatId = String(message.chat.id);
  const chatType = message.chat.type;
  const allowed = isAllowedGroupChat(
    chatId,
    chatType,
    parseAllowedGroupIds(process.env.TELEGRAM_ALLOWED_GROUP_IDS),
  );

  console.log("[Telegram Webhook] Incoming message", {
    updateId: update.update_id,
    chatId,
    chatType,
    allowed,
  });

  if (!allowed) {
    /*
     * Sapaan satu kali untuk grup yang belum terdaftar.
     *
     * Tanpa ini, gejalanya adalah "tidak terjadi apa-apa": bot terlihat
     * hidup, webhook membalas 200, tapi tidak ada satu baris pun yang
     * muncul di Telegram. Operator harus menggali log server untuk
     * menemukan satu baris `allowed: false` - dan ID grup-nya ada di
     * sana dalam bentuk mentah.
     *
     * Pesan ini menuliskan ID-nya sendiri, jadi memperbaikinya cukup
     * menyalin satu baris dari chat yang sedang terjadi.
     *
     * Hanya untuk chat GRUP. Chat pribadi diabaikan tanpa sapaan -
     * kalau tidak, siapa pun yang DM bot akan diberi tahu cara
     * mendaftarkan grup, dan itu bukan miliknya.
     */
    if (chatType === "group" || chatType === "supergroup") {
      await notifyUnregisteredGroup(chatId);
    }

    return Response.json({ ok: true, ignored: true });
  }

  const parsed = parseTelegramCommand(text);
  if (!parsed) {
    return Response.json({ ok: true, ignored: "bukan-perintah" });
  }

  try {
    if (await alreadyProcessed(update.update_id)) {
      return Response.json({ ok: true, duplicate: true });
    }

    const result = await runBotCommand({
      command: parsed.command,
      argument: parsed.argument,
      chatId,
    });

    console.log("[Telegram Webhook] Reply target", {
      command: parsed.command,
      chatId,
    });

    // Explicitly route the response to the originating group, not the admin DM.
    const delivery = await sendTelegramMessage(result.text, {
      kind: "command",
      parseMode: "HTML",
      chatId,
    });

    if (!delivery.sent) {
      throw new Error(`Balasan Telegram tidak terkirim: ${delivery.reason}`);
    }

    await rememberUpdate(update.update_id);

    return Response.json({
      ok: true,
      command: parsed.command,
      mutating: result.mutating ?? false,
    });
  } catch (error) {
    console.error("[Telegram Webhook] Perintah gagal:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Kesalahan tidak diketahui.";

    // Error response also goes to the originating group.
    await sendTelegramMessage(
      `Perintah ${parsed.command} gagal: ${errorMessage}`,
      {
        kind: "command",
        chatId,
      },
    ).catch((sendError) => {
      console.error(
        "[Telegram Webhook] Gagal mengirim pesan error:",
        sendError,
      );
    });

    return Response.json(
      { ok: false, error: "Perintah gagal dijalankan." },
      { status: 500 },
    );
  }
}

export async function GET() {
  return Response.json({
    ok: false,
    error: "Webhook Telegram hanya menerima POST.",
    hint: "Daftarkan lewat scripts/telegram-set-webhook.mjs",
  });
}
