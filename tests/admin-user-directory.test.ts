import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminUserDirectory } from "../src/lib/admin-user-directory.ts";

/**
 * Daftar pengguna di halaman admin.
 *
 * Bug yang memicu test ini sudah terjadi sungguhan: seorang pengguna
 * terdaftar (2026-10-14) TIDAK MUNCUL di halaman admin sama sekali.
 *
 * Akar masalahnya bukan filter di UI, tapi cara daftarnya disusun. Versi
 * lama membangun himpunan id dari `customer_profiles` union
 * `orders.customer_user_id`. Padahal `customer_profiles` hanya dibuat
 * saat pengguna menyimpan profil atau membuat order - tidak ada baris saat
 * pendaftaran. Jadi "daftar lalu pergi tanpa bertransaksi" menghasilkan
 * nol baris di kedua sumber itu, dan padahal dia akun sungguhan.
 *
 * Daftar akun dari Supabase Auth sebenarnya sudah diambil, tapi hanya
 * dipakai untuk mencari email.
 */

type Profile = {
  user_id: string;
  display_name: string | null;
  whatsapp: string | null;
  preferred_receipt_channel: string | null;
  updated_at: string | null;
};

type AuthUser = { id: string; email?: string | null };

type OrderStat = {
  user_id: string;
  orders: number | string;
  success: number | string;
  spend: number | string;
  last_order_at: string | null;
};

const HANA = "6475a146-3a28-4044-b80d-7574f87ca785";
const AFIF = "42872b4d-3a6c-4d6a-a4ec-6ca8260630f1";
const ZACKY = "789842fe-0336-41ad-84ac-b54f29f7912a";

function directory(input: {
  authUsers: AuthUser[];
  profiles?: Profile[];
  stats?: OrderStat[];
}) {
  return buildAdminUserDirectory({
    authUsers: input.authUsers,
    profiles: input.profiles ?? [],
    stats: input.stats ?? [],
  });
}

test("AKUN YANG DAFTAR TANPA AKSI TETAP MUNCUL", () => {
  /*
   * Kasus nyata: Hana daftar, tidak menyimpan profil, tidak membuat order.
   * Versi lama menghasilkan daftar kosong untuk dia.
   */
  const result = directory({ authUsers: [{ id: HANA, email: "hana@example.com" }] });

  assert.equal(result.users.length, 1, "akun tanpa profil dan tanpa order harus tetap ada");
  assert.equal(result.users[0].userId, HANA);
  assert.equal(result.users[0].email, "hana@example.com");
  assert.equal(result.users[0].orders, 0);
  assert.equal(result.users[0].spend, 0);
  assert.equal(result.users[0].displayName, null);
});

test("akun tanpa email tetap muncul dengan id-nya", () => {
  const result = directory({ authUsers: [{ id: AFIF }] });

  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].email, null);
});

test("daftar kosong tetap kosong", () => {
  const result = directory({ authUsers: [] });

  assert.deepEqual(result.users, []);
  assert.equal(result.total, 0);
});

test("profil dan order melengkapi, bukan menggantikan", () => {
  const result = directory({
    authUsers: [
      { id: ZACKY, email: "zacky@example.com" },
      { id: HANA, email: "hana@example.com" },
      { id: AFIF, email: "afif@example.com" },
    ],
    profiles: [
      {
        user_id: ZACKY,
        display_name: "Zacky",
        whatsapp: "08123456789",
        preferred_receipt_channel: "email",
        updated_at: "2026-10-05T00:00:00Z",
      },
    ],
    stats: [
      {
        user_id: AFIF,
        orders: "3",
        success: "2",
        spend: "150000",
        last_order_at: "2026-10-11T00:00:00Z",
      },
    ],
  });

  assert.equal(result.users.length, 3, "ketiganya harus ada");
  assert.equal(result.total, 3);

  const zacky = result.users.find((u) => u.userId === ZACKY);
  assert.equal(zacky?.displayName, "Zacky");
  assert.equal(zacky?.whatsapp, "08123456789");
  assert.equal(zacky?.orders, 0);

  const afif = result.users.find((u) => u.userId === AFIF);
  assert.equal(afif?.orders, 3);
  assert.equal(afif?.success, 2);
  assert.equal(afif?.spend, 150000);
});

test("akun yang tidak ada di Supabase Auth tidak muncul", () => {
  /*
   * Profil dan order bisa menyisakan akun yang sudah dihapus dari Auth.
   * Baris seperti itu harus ikut hilang, kalau tidak operator akan mencari
   * user yang sudah tidak ada dan tidak menemukannya.
   */
  const orphan = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const result = directory({
    authUsers: [{ id: HANA, email: "hana@example.com" }],
    profiles: [
      {
        user_id: orphan,
        display_name: "Hantu",
        whatsapp: null,
        preferred_receipt_channel: null,
        updated_at: null,
      },
    ],
  });

  assert.equal(result.users.length, 1);
  assert.equal(result.users.some((u) => u.userId === orphan), false);
});

test("userId yang sama tidak menghasilkan baris ganda", () => {
  const result = directory({
    authUsers: [{ id: HANA, email: "hana@example.com" }],
    profiles: [
      {
        user_id: HANA,
        display_name: "Hana",
        whatsapp: null,
        preferred_receipt_channel: null,
        updated_at: null,
      },
    ],
    stats: [
      {
        user_id: HANA,
        orders: 1,
        success: 1,
        spend: 10000,
        last_order_at: null,
      },
    ],
  });

  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].displayName, "Hana");
  assert.equal(result.users[0].orders, 1);
});

test("angka dari database dibaca sebagai number, bukan string", () => {
  /*
   * Postgres mengembalikan bigint sebagai string lewat PostgREST. Tanpa
   * konversi, `1 + orders` di UI jadi "11" dan total belanja jadi
   *_naif_ benar secara tak terlihat.
   */
  const result = directory({
    authUsers: [{ id: HANA }],
    stats: [
      {
        user_id: HANA,
        orders: "12",
        success: "7",
        spend: "99000",
        last_order_at: null,
      },
    ],
  });

  assert.equal(result.users[0].orders, 12);
  assert.equal(result.users[0].success, 7);
  assert.equal(result.users[0].spend, 99000);
});

test("premiumReceiptChannel default ke email", () => {
  const result = directory({
    authUsers: [{ id: HANA }],
    profiles: [
      {
        user_id: HANA,
        display_name: null,
        whatsapp: null,
        preferred_receipt_channel: null,
        updated_at: null,
      },
    ],
  });

  assert.equal(result.users[0].preferredReceiptChannel, "email");
});

test("baris rusak di stats tidak membuat seluruh daftar gagal", () => {
  /*
   * Baris tanpa `user_id` tidak mungkin terjadi dari SQL yang benar, tapi
   * kalau terjadi, melemparnya berarti seluruh halaman admin mati - dan
   * satu baris rusak lebih mudah diperbaiki daripada halaman kosong.
   *
   * Baris untuk akun yang TIDAK terdaftar juga diabaikan, sesuai aturan
   * sumber kebenaran: statistik tidak boleh resurrect akun yang sudah
   * dihapus dari Supabase Auth.
   */
  const result = directory({
    authUsers: [{ id: HANA, email: "hana@example.com" }],
    stats: [
      {
        user_id: "",
        orders: 1,
        success: 1,
        spend: 100,
        last_order_at: null,
      },
      {
        user_id: AFIF,
        orders: 2,
        success: 2,
        spend: 200,
        last_order_at: null,
      },
    ],
  });

  assert.equal(result.users.length, 1);
  assert.equal(result.users[0].userId, HANA);
  assert.equal(result.users[0].orders, 0);
});