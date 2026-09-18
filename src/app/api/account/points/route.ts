import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import {
  getPointsLedger,
  getPointsSummary,
} from "@/lib/loyalty";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
    });
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json(
        { error: "Login diperlukan." },
        { status: 401, headers },
      );
    }

    const [summary, ledger] = await Promise.all([
      getPointsSummary(auth.user.id),
      getPointsLedger(auth.user.id, 30),
    ]);

    return Response.json(
      {
        points: summary,
        ledger,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Nambah Points account API failed", error);
    return Response.json(
      { error: "Nambah Points belum dapat dimuat." },
      { status: 503 },
    );
  }
}
