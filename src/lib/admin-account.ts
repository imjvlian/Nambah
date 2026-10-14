import type { AdminRole } from "@/lib/admin-access-rules";
import { extractRpcMessage } from "@/lib/supabase/rpc-error";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase/server";

export type NambahAdminRole = AdminRole;

export type NambahAdminAccount = {
  userId: string;
  role: NambahAdminRole;
  active: boolean;
};

export type NambahAdminAccountRow = NambahAdminAccount & {
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * Jumlah superadmin aktif saat baris ini dibaca.
   *
   * Disalin ke setiap baris, bukan per baris. UI membutuhkannya untuk
   * menonaktifkan tombol yang akan menyisakan nol superadmin SEBELUM request
   * dikirim - angka yang sama dengan yang akan dicek migration, jadi layar
   * dan server tidak mungkin berbeda jawaban.
   */
  activeSuperadmins: number;
};

type AdminUserRow = {
  user_id: string;
  role: string;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export async function getNambahAdminAccount(
  userId: string,
): Promise<NambahAdminAccount | null> {
  if (!userId) return null;

  const [row] = await supabaseSelect<AdminUserRow>("admin_users", {
    select: "user_id,role,active",
    filters: {
      user_id: `eq.${userId}`,
      active: "eq.true",
    },
    limit: 1,
  });

  if (!row) return null;

  return {
    userId: row.user_id,
    role: row.role as NambahAdminRole,
    active: row.active,
  };
}

/**
 * Daftar seluruh akun admin, aktif maupun nonaktif.
 *
 * Nonaktif ikut diambil karena demote berarti "matikan akses", bukan
 * "hapus orang". Kalau baris nonaktif tidak tampil, operator tidak punya
 * cara menghidupkan kembali tanpa SQL manual - dan promote lagi melalui UI
 * akan terlihat seperti membuat akun dari nol.
 *
 * Baris diambil dari view `admin_users_with_counts` (migration 049) supaya
 * daftar dan angka penghitung superadmin berasal dari satu pembacaan.
 */
export async function listNambahAdminAccounts(): Promise<NambahAdminAccountRow[]> {
  const rows = await supabaseSelect<AdminUserRow>(
    "admin_users_with_counts",
    {
      select: "user_id,role,active,created_at,updated_at,active_superadmins",
      order: "created_at.asc",
      limit: 500,
    },
  );

  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role as NambahAdminRole,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeSuperadmins: Number(
      (row as AdminUserRow & { active_superadmins?: number }).active_superadmins ?? 0,
    ),
  }));
}

/** Baris admin untuk satu akun, termasuk yang nonaktif. */
export async function getNambahAdminAccountRow(
  userId: string,
): Promise<NambahAdminAccountRow | null> {
  const rows = await listNambahAdminAccounts();
  return rows.find((row) => row.userId === userId) ?? null;
}

/** Jumlah superadmin aktif. Diambil dari view, bukan dihitung ulang di sini. */
export async function countActiveSuperadmins(): Promise<number> {
  const rows = await listNambahAdminAccounts();
  return rows[0]?.activeSuperadmins ?? 0;
}

/**
 * Menjalankan perubahan role lewat RPC, bukan langsung menulis tabel.
 *
 * RPC yang memegang pengaman lockout. Menulis `admin_users` langsung dari
 * route akan melewati seluruh pemeriksaan itu - dan pemeriksaan itu satu-
 * satunya yang mencegah dashboard terkunci.
 */
export async function setNambahAdminRole(input: {
  userId: string;
  role: NambahAdminRole;
  active: boolean;
}) {
  try {
    return await supabaseRpc<{
      userId: string;
      role: NambahAdminRole;
      active: boolean;
      changed: boolean;
      activeSuperadmins: number;
    }>("nambah_set_admin_role", {
      p_user_id: input.userId,
      p_role: input.role,
      p_active: input.active,
    });
  } catch (error) {
    /*
     * Penolakan lockout hidup di dalam RPC, jadi penolakannya sampai ke
     * sini sebagai error. Pesannya diteruskan apa adanya supaya operator
     * membaca alasan yang sebenarnya, bukan string teknis PostgREST.
     */
    throw new Error(extractRpcMessage(error));
  }
}