import { timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeAdminRequest(request: Request) {
  const configuredToken = process.env.NAMBAH_ADMIN_API_TOKEN?.trim() ?? "";
  if (!configuredToken) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Admin API token belum dikonfigurasi." },
        { status: 503 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const suppliedToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!suppliedToken || !safeEqual(suppliedToken, configuredToken)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { ok: true as const };
}
