/**
 * Penyusun daftar pengguna untuk halaman admin.
 *
 * FUNGSI INI MURNI
 *
 * Tidak ada database, tidak ada request. Semuanya masuk lewat parameter.
 * Dipisah dari route karena daftar ini pernah salah secara struktural -
 * bukan karena ada filter yang salah, tapi karena sumber kebenarannya salah
 * - dan bug seperti itu tidak akan pernah ditemukan test yang tidak bisa
 * menuliskan kasusnya sendiri.
 *
 * SUMBER KEBENARAN: DAFTAR AKUN
 *
 * `customer_profiles` hanya dibuat saat pengguna menyimpan profil atau
 * membuat order. Tidak ada baris yang ditulis saat pendaftaran. Jadi
 * memakai profil sebagai sumber daftar berarti "daftar lalu pergi tanpa
 * bertransaksi" menghasilkan nol baris - padahal dia akun sungguhan yang
 * nyata dan bisa masuk.
 *
 * Karena itu himpunan id dibangun dari DAFTAR AKUN lebih dulu, dan profil
 * serta order hanya menambah rincian yang tidak ada di sana. Urutan ini
 * tidak boleh dibalik.
 *
 * BARIS YATAH SISA
 *
 * Profil dan order bisa menyisakan baris untuk akun yang sudah dihapus
 * dari Supabase Auth. Baris seperti itu sengaja tidak ditampilkan: operator
 * tidak akan pernah menemukannya, dan mencarinya hanya membuang waktu.
 */

export type AdminDirectoryProfile = {
  user_id: string;
  display_name: string | null;
  whatsapp: string | null;
  preferred_receipt_channel: string | null;
  updated_at: string | null;
};

export type AdminDirectoryAuthUser = { id: string; email?: string | null };

export type AdminDirectoryOrderStat = {
  user_id: string;
  orders: number | string;
  success: number | string;
  spend: number | string;
  last_order_at: string | null;
};

type AdminDirectoryStats = {
  orders: number;
  success: number;
  spend: number;
  lastOrderAt: string | null;
};

export type AdminDirectoryUser = AdminDirectoryStats & {
  userId: string;
  displayName: string | null;
  email: string | null;
  whatsapp: string | null;
  preferredReceiptChannel: string;
  profileUpdatedAt: string | null;
};

const EMPTY_STATS: AdminDirectoryStats = {
  orders: 0,
  success: 0,
  spend: 0,
  lastOrderAt: null,
};

export function buildAdminUserDirectory(input: {
  authUsers: AdminDirectoryAuthUser[];
  profiles: AdminDirectoryProfile[];
  stats: AdminDirectoryOrderStat[];
}): { users: AdminDirectoryUser[]; total: number } {
  const emailById = new Map<string, string>();
  for (const user of input.authUsers) {
    if (user.email) emailById.set(user.id, user.email);
  }

  const profileById = new Map<string, AdminDirectoryProfile>();
  for (const profile of input.profiles) {
    if (profile.user_id) profileById.set(profile.user_id, profile);
  }

  const statsById = new Map<string, AdminDirectoryStats>();
  for (const row of input.stats) {
    if (!row.user_id) continue;

    /*
     * Postgres mengirim bigint sebagai string lewat PostgREST. Tanpa
     * konversi di sini, penjumlahan di UI menempelkan angka -
     * `1 + "12"` menghasilkan `"112"`, dan errornya terlihat benar.
     */
    const orders = Number(row.orders ?? 0);
    const success = Number(row.success ?? 0);
    const spend = Number(row.spend ?? 0);

    statsById.set(row.user_id, {
      orders: Number.isFinite(orders) ? orders : 0,
      success: Number.isFinite(success) ? success : 0,
      spend: Number.isFinite(spend) ? spend : 0,
      lastOrderAt: row.last_order_at,
    });
  }

  const ids = new Set<string>();
  for (const user of input.authUsers) {
    if (user.id) ids.add(user.id);
  }

  const users = Array.from(ids).map((userId) => {
    const profile = profileById.get(userId);
    const stats = statsById.get(userId);

    return {
      userId,
      displayName: profile?.display_name ?? null,
      email: emailById.get(userId) ?? null,
      whatsapp: profile?.whatsapp ?? null,
      preferredReceiptChannel: profile?.preferred_receipt_channel ?? "email",
      profileUpdatedAt: profile?.updated_at ?? null,
      ...(stats ?? EMPTY_STATS),
    };
  });

  return { users, total: users.length };
}