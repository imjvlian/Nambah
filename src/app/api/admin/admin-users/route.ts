import { getNambahAdminAccountRow, listNambahAdminAccounts, setNambahAdminRole } from "@/lib/admin-account";
import { decideRoleChange, isAdminRole, isUuid } from "@/lib/admin-access-rules";
import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseAuthAdminListUsers,
  supabaseSelect,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Daftar akun admin, plus info yang dibutuhkan untuk menampilkannya.
 *
 * Hanya superadmin, bukan hanya untuk menulis. Email dan nomor WhatsApp admin
 * adalah data yang tidak perlu dilihat oleh role yang tidak berwenang
 * mengubah akses - jadi membocorkannya tidak menambah nilai apa pun.
 */
export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  try {
    const [admins, authUsers, profiles] = await Promise.all([
      listNambahAdminAccounts(),
      // Kegagalan di sini tidak boleh mematikan seluruh halaman: daftar admin
      // tetap berguna tanpa email.
      supabaseAuthAdminListUsers().catch(() => []),
      supabaseSelect<{ user_id: string; display_name: string | null; whatsapp: string | null }>(
        "customer_profiles",
        { select: "user_id,display_name,whatsapp", limit: 1000 },
      ).catch(() => []),
    ]);

    const emailById = new Map(
      authUsers.filter((user) => user.email).map((user) => [user.id, user.email as string]),
    );
    const profileById = new Map(profiles.map((row) => [row.user_id, row]));

    return Response.json({
      admins: admins.map((admin) => {
        const profile = profileById.get(admin.userId);
        return {
          userId: admin.userId,
          role: admin.role,
          active: admin.active,
          createdAt: admin.createdAt,
          updatedAt: admin.updatedAt,
          activeSuperadmins: admin.activeSuperadmins,
          email: emailById.get(admin.userId) ?? null,
          displayName: profile?.display_name ?? null,
          whatsapp: profile?.whatsapp ?? null,
          isSelf: admin.userId === auth.principal.userId,
        };
      }),
    });
  } catch (error) {
    console.error("Admin account list failed", error);
    return Response.json(
      { error: "Daftar akun admin tidak dapat dimuat." },
      { status: 502 },
    );
  }
}

/**
 * Promote atau demote satu akun.
 *
 * Urutan tiga langkah ini disengaja dan tidak boleh diubah:
 *
 *  1. Rules murni menolak lebih dulu. Pesannya informatif dan statusnya
 *     tepat, jadi UI bisa menampilkannya apa adanya.
 *  2. RPC menjalankan pengaman lockout di dalam transaksi. Inilah yang
 *     benar-benar mencegah dashboard terkunci - pemeriksaan langkah 1 hanya
 *     melindungi dari klik tidak sengaja.
 *  3. Audit ditulis setelah berhasil, supaya jejaknya tidak pernah berisi
 *     perubahan yang gagal.
 */
export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  let body: { userId?: unknown; role?: unknown; active?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "Permintaan perubahan akses tidak valid." },
      { status: 400 },
    );
  }

  const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const nextRole = body.role;
  const nextActive = body.active === true;

  if (!isUuid(targetUserId)) {
    return Response.json({ error: "Akun tujuan tidak valid." }, { status: 400 });
  }
  if (!isAdminRole(nextRole)) {
    return Response.json(
      { error: "Role admin harus admin atau superadmin." },
      { status: 400 },
    );
  }

  try {
    const current = await getNambahAdminAccountRow(targetUserId);

    /*
     * Role AKTUAL dari database yang dipakai untuk keputusan, bukan role yang
     * dikirim klien. Kalau klien bilang `superadmin` padahal barisnya `admin`,
     * aturan lockout akan dievaluasi terhadap keadaan yang salah - dan
     * pengaman superadmin terakhir bisa lolos.
     */
    const targetRole = (current?.role ?? nextRole) as "admin" | "superadmin";
    const targetActive = current?.active ?? false;
    const activeSuperadmins = current?.activeSuperadmins ?? 0;

    const decision = decideRoleChange({
      actorRole: auth.principal.role,
      actorUserId: auth.principal.userId,
      targetUserId,
      targetRole,
      targetActive,
      nextActive,
      // Role SESUDAH perubahan, bukan role sekarang. Penurunan superadmin
      // ke admin biasa mengurangi jumlah superadmin sama seperti
      // penonaktifannya, dan jalur itu tidak terlihat di UI.
      nextRole: nextRole as "admin" | "superadmin",
      activeSuperadminCount: activeSuperadmins,
    });

    if (!decision.ok) {
      return Response.json({ error: decision.error }, { status: decision.status });
    }

    const result = await setNambahAdminRole({
      userId: targetUserId,
      role: nextRole,
      active: nextActive,
    });

    await auditAdminAction(request, {
      action: decision.action === "demote" ? "admin.demote" : "admin.promote",
      targetType: "admin_user",
      targetId: targetUserId,
      metadata: {
        fromRole: current?.role ?? null,
        toRole: nextRole,
        active: nextActive,
        changed: result?.changed ?? null,
      },
    });

    return Response.json({
      ok: true,
      changed: result?.changed ?? false,
      role: result?.role ?? nextRole,
      active: result?.active ?? nextActive,
      activeSuperadmins: result?.activeSuperadmins ?? activeSuperadmins,
    });
  } catch (error) {
    /*
     * Pengaman lockout hidup di dalam RPC, jadi penolakannya sampai ke sini
     * sebagai error. Pesannya dari database, dan itu pesan yang tepat untuk
     * ditampilkan - ditulis ulang di sini hanya akan mengganti penjelasan
     * yang benar dengan yang generik.
     */
    console.error("Admin role change failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Perubahan akses gagal." },
      { status: 409 },
    );
  }
}