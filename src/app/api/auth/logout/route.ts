import {
  appendClearNambahAuthCookies,
  readNambahAccessToken,
  signOutNambah,
} from "@/lib/nambah-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = readNambahAccessToken(request);
  try {
    if (token) await signOutNambah(token);
  } catch (error) {
    console.error("Nambah logout upstream failed", error);
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
  });
  appendClearNambahAuthCookies(headers);
  return Response.json({ signedOut: true }, { headers });
}
