import { authorizeAdminRequest } from "@/lib/admin-api";
import { buildAdminUserDirectory } from "@/lib/admin-user-directory";
import {
  supabaseAuthAdminListUsers,
  supabaseRpc,
  supabaseSelectAll,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  whatsapp: string | null;
  preferred_receipt_channel: string;
  created_at: string;
  updated_at: string;
};

type OrderStatRow = {
  user_id: string;
  orders: number | string;
  success: number | string;
  spend: number | string;
  last_order_at: string | null;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const [profiles, orderStats, authUsers] = await Promise.all([
      /*
       * `selectAll`, bukan `select` dengan limit.
       *
       * Versi lama memakai limit 1000 yang tidak pernah diumumkan. Melewati
       * angka itu, profil user langka diam-diam hilang dari daftar - jenis
       * bug yang sama dengan yang jadi akar masalah halaman ini, dan akan
       * muncul lagi kalau tidak dihapus sekarang.
       */
      supabaseSelectAll<ProfileRow>("customer_profiles", {
        select:
          "user_id,display_name,whatsapp,preferred_receipt_channel,created_at,updated_at",
        order: "updated_at.desc",
      }).catch(() => [] as ProfileRow[]),

      /*
       * Agregat dari database.
       *
       * Versi lama menarik 5000 order terbaru dan menjumlahkannya di
       * memori. Di bawah 5000 order hasilnya benar; di atasnya, user lama
       * tampil dengan angka yang salah dan tidak ada apa pun yang
       * memberi tahu. RPC ini tidak punya batas baris.
       */
      supabaseRpc<OrderStatRow[]>("nambah_customer_order_stats").catch(
        () => [] as OrderStatRow[],
      ),

      // Kegagalan di sini tidak boleh mematikan seluruh halaman: daftar
      // profil dan statistik order masih berguna tanpa daftar akun.
      supabaseAuthAdminListUsers().catch(() => []),
    ]);

    /*
     * DAFTAR USER = DAFTAR AKUN, BUKAN DAFTAR AKTIVITAS.
     *
     * Bug yang diperbaiki di sini: id himpunan dibangun dari profil dan
     * order saja. `customer_profiles` hanya dibuat saat pengguna menyimpan
     * profil atau membuat order - tidak ada baris saat pendaftaran. Jadi
     * siapa yang daftar lalu pergi tanpa bertransaksi TIDAK PERNAH MUNCUL,
     * padahal dia akun sungguhan. Daftar akun dari Supabase Auth sudah
     * diambil sejak lama, tapi hanya dipakai untuk mencari email.
     *
     * Sekarang auth users adalah sumber kebenarannya, dan profil serta
     * order hanya menambah rincian yang tidak ada di sana.
     *
     * Penyusunannya dipindah ke `admin-user-directory.ts` supaya aturan ini
     * bisa diuji. Bug struktural seperti ini tidak akan pernah ditemukan
     * test yang menuliskan kasus "pengguna daftar tapi belum bertransaksi".
     */
    const directory = buildAdminUserDirectory({
      authUsers,
      profiles,
      stats: orderStats,
    });

    return Response.json({
      users: directory.users,
      /*
       * Jumlah total dikirim terpisah, bukan hanya lewat `users.length`.
       *
       * Yang dikirim adalah SELURUH daftar, jadi `users.length` sudah cukup
       * - tapi begitu UI mulai memangkas (pencarian, paginasi), angka itu
       * berhenti artinya. Total eksplisit membuat UI bisa selalu
       * menulis "menampilkan 25 dari 143" tanpa harus menebak.
       */
      total: directory.total,
    });
  } catch (error) {
    console.error("Admin user lookup failed", error);
    return Response.json(
      { error: "Data user tidak dapat dimuat." },
      { status: 502 },
    );
  }
}