/**
 * Pesan yang bisa ditampilkan dari kegagalan RPC.
 *
 * `supabaseRpc` membungkus kegagalan menjadi satu string:
 *
 *   Supabase RPC nambah_set_admin_role failed (400): {"message":"Ini
 *   superadmin aktif terakhir.","code":"P0001"}
 *
 * String itu aman untuk log, tapi tidak untuk layar. Untuk fitur perubahan
 * role, isi `message` justru satu-satunya penjelasan yang berguna - dan
 * operator perlu membacanya untuk tahu kenapa tombolnya ditolak.
 *
 * Fungsi ini tidak melempar. Kalau bentuknya tidak dikenali, ia
 * mengembalikan pesan aslinya: lebih baik menampilkan string teknis
 * daripada tidak menampilkan alasan sama sekali.
 */
export function extractRpcMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");

  const start = raw.lastIndexOf("): ");
  if (start === -1) return raw.trim();

  const body = raw.slice(start + 3).trim();
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    /* Bentuk lain - pakai pesan aslinya. */
  }

  return raw.trim();
}