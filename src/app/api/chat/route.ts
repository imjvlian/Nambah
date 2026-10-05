import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { answerChat, sanitizeChatMessages } from "@/lib/chatbot";
import { rateLimitResponse } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Chat belum tersedia." }, { status: 503 });
  }

  const limited = await rateLimitResponse(request, {
    scope: "chat",
    limit: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  let messages;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    messages = sanitizeChatMessages(body.messages);
  } catch {
    return Response.json({ error: "Payload chat tidak valid." }, { status: 400 });
  }

  if (!messages) {
    return Response.json(
      { error: "Format pesan tidak valid." },
      { status: 400 },
    );
  }

  // Auth opsional: user login -> bot boleh melihat order miliknya sendiri.
  // Tamu tetap dilayani untuk FAQ umum.
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  let userId: string | null = null;
  try {
    const auth = await resolveNambahAuth(request);
    appendResolvedNambahAuthCookies(headers, auth);
    userId = auth.user?.id ?? null;
  } catch (error) {
    if (error instanceof NambahAuthError) {
      console.warn("Chat auth refresh failed, melayani sebagai tamu.");
    } else {
      console.error("Chat auth resolve failed", error);
    }
  }

  try {
    const result = await answerChat({ messages, userId });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Chat answer failed", error);
    return Response.json(
      { error: "Assistant sedang tidak bisa menjawab. Coba lagi sebentar lagi." },
      { status: 503, headers },
    );
  }
}
