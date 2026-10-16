import { isSupabaseConfigured, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  let database = false;
  if (isSupabaseConfigured()) {
    try {
      await supabaseSelect<{ id: string }>("games", {
        select: "id",
        limit: 1,
      });
      database = true;
    } catch {
      database = false;
    }
  }

  return Response.json(
    {
      status: database ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
    },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
