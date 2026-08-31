export function isTelegramConfigured() {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_ADMIN_CHAT_ID?.trim(),
  );
}

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() ?? "";

  if (!token || !chatId) {
    return { sent: false as const, reason: "not-configured" as const };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed (${response.status}): ${raw}`);
    }

    return { sent: true as const };
  } finally {
    clearTimeout(timeout);
  }
}
