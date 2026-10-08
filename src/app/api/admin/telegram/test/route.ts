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
      [
        "<b>Nambah — Telegram aktif.</b>",
        "",
        "Notifikasi yang dikirim dari sini:",
        "  • saldo Digiflazz saat status berubah",
        "  • incident operasional kritis",
        "  • order nyangkut",
        "  • fulfilment gagal, receipt gagal",
        "  • digest harian 08:00 WIB",
      ].join("\n"),
      {
        kind: "ops",
        // Dedupe per menit: menekan tombol beberapa kali tidak boleh
        // membanjiri chat, tapi tetap bisa dites berulang.
        dedupeKey: `test:${new Date().toISOString().slice(0, 16)}`,
        parseMode: "HTML",
      },
    );
    return Response.json(result);
  } catch (error) {
    console.error("Telegram test failed", error);
    return Response.json({ error: "Tes Telegram gagal dikirim." }, { status: 502 });
  }
}
