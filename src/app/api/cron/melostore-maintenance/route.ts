import { authorizeCronRequest } from "@/lib/cron-api";

export const runtime = "nodejs";

/**
 * Maintenance Melostore terjadwal (scan katalog saat basi + saldo).
 *
 * Proxy tipis ke GET /api/admin/digiflazz/melostore-sync?maintenance=1:
 * logika maintenance yang sesungguhnya (scan 44 halaman berpacing,
 * deaktivasi aman hanya saat sukses penuh, auto-merge, tulis saldo)
 * hidup di route itu dan sudah tervalidasi - menyalinnya ke sini berarti
 * dua tempat yang bisa berbeda diam-diam.
 *
 * Scan penuh +-3 menit; unit systemd sudah TimeoutStartSec=420 dan
 * curl di run-script memakai --max-time 300 - keduanya cukup.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const target = new URL(
    "/api/admin/digiflazz/melostore-sync?maintenance=1",
    request.url,
  );
  const response = await fetch(target, {
    method: "GET",
    headers: {
      Authorization: request.headers.get("Authorization") ?? "",
    },
    cache: "no-store",
  });

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
