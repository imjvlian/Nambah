import {
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";
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

/** Allow only explicitly configured Telegram groups/supergroups. */
function isAllowedGroupChat(chatId: string, chatType: string): boolean {
  if (chatType !== "group" && chatType !== "supergroup") return false;

  const allowedGroupIds = (process.env.TELEGRAM_ALLOWED_GROUP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return allowedGroupIds.includes(chatId);
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
  const allowed = isAllowedGroupChat(chatId, chatType);

  console.log("[Telegram Webhook] Incoming message", {
    updateId: update.update_id,
    chatId,
    chatType,
    allowed,
  });

  if (!allowed) {
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
