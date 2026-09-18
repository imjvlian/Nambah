import { supabaseSelect } from "@/lib/supabase/server";

export type NambahAdminRole = "admin" | "superadmin";

export type NambahAdminAccount = {
  userId: string;
  role: NambahAdminRole;
  active: boolean;
};

type AdminUserRow = {
  user_id: string;
  role: NambahAdminRole;
  active: boolean;
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
    role: row.role,
    active: row.active,
  };
}
