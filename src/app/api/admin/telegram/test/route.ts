import { authorizeAdminRequest } from "@/lib/admin-api";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  if (!isTelegramConfigured()) {
    return Response.json(
      { error: "Telegram bot belum dikonfigurasi." },
      { status: 503 },
    );
  }

  try {
    const result = await sendTelegramMessage(
      "✅ Nambah — Telegram monitoring aktif.\n\nNotifikasi saldo Digiflazz akan dikirim saat status berubah.",
    );
    return Response.json(result);
  } catch (error) {
    console.error("Telegram test failed", error);
    return Response.json({ error: "Test Telegram gagal dikirim." }, { status: 502 });
  }
}
