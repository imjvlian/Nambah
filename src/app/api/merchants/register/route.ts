import {
  generateMerchantPin,
  hashMerchantPin,
} from "@/lib/merchant-pin";
import { isMerchantRetailEnabled } from "@/lib/merchant-retail";
import { rateLimitResponse } from "@/lib/rate-limit";
import { supabaseInsert, supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/merchants/register — pemilik toko mendaftar sendiri.
 *
 * Mendaftarkan TOKO, bukan akun kasir. Yang didaftarkan adalah nama toko dan
 * alamat; PIN kasir diberikan sebagai respons dan hanya bisa dilihat sekali.
 *
 * STATUS AWAL SELALU `pending`.
 *
 * Ini bukan sekadar detail implementasi - ini yang membuat fitur ini aman
 * dibuka untuk publik. Lacte menanggung `supplier_cost` sejak merchant
 * memindai pesanan, dan `MAX_RECEIVABLE_IDR` membatasi PER TOKO. Kalau daftar
 * langsung menghasilkan toko `active`, siapa pun bisa mendaftar, langsung
 * menerima order, lalu tidak pernah membayar. Satu pendaftaran = satu limit
 * penuh, dan pendaftaran otomatis berarti eksposur tanpa batas.
 *
 * Jadi: daftar → `pending` → admin menyetujui → `active`. Toko yang belum
 * disetujui tidak bisa muncul di checkout, tidak bisa memindai, dan tidak
 * punya piutang.
 *
 * Rate limit 5 per jam per IP. Pendaftaran yang sahاء dibatasi satu kali per
 * toko; sisanya adalah penyalahgunaan.
 */
export async function POST(request: Request) {
  if (!isMerchantRetailEnabled()) {
    return Response.json(
      { error: "Program toko ritel belum dibuka." },
      { status: 403 },
    );
  }

  const limited = await rateLimitResponse(request, {
    scope: "merchant_register",
    limit: 5,
    windowSeconds: 3600,
  });
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const contact =
    typeof body.contact === "string" ? body.contact.trim() : "";

  if (name.length < 2 || name.length > 120) {
    return Response.json(
      { error: "Nama toko harus 2-120 karakter." },
      { status: 400 },
    );
  }

  // Alamat tidak opsional karena admin butuh info ini untuk memverifikasi
  // toko sungguhan sebelum menyetujui. Tanpa itu, antrean `pending` jadi
  // sekumpulan nama tanpa jejak.
  if (address.length < 5 || address.length > 240) {
    return Response.json(
      { error: "Alamat toko wajib diisi (5-240 karakter)." },
      { status: 400 },
    );
  }

  // Nomor HP opsional tapi harus wajar kalau diisi - dipakai admin saat
  // menghubungi untuk verifikasi.
  if (contact && !/^[0-9+\-\s()]{8,24}$/.test(contact)) {
    return Response.json(
      { error: "Nomor kontak tidak valid." },
      { status: 400 },
    );
  }

  /*
   * Kode toko dibuat server-side, bukan diminta dari pemohon.
   *
   * Kalau pemohon yang memilih, dia bisa membuat kode yang mirip kode toko
   * lain untuk mengelabui kasir. Kode yang acak dan tidak terduga menutup
   * kemungkinan itu.
   */
  const code = generateMerchantCode();
  const pin = generateMerchantPin();

  const inserted = await supabaseInsert("merchants", {
    name,
    code,
    address,
    contact: contact || null,
    // Admin yang menentukan fee dan termin - bukan pemohon. Sekarang fee
    // flat, jadi tidak ada lagi tempat pemohon bisa merasa dia menentukan
    // komisi sendiri.
    service_fee_flat_idr: 0,
    payment_term_days: 7,
    status: "pending",
    notes: "Mendaftar sendiri lewat halaman publik.",
    pin_hash: hashMerchantPin(pin),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (inserted.length === 0) {
    return Response.json(
      {
        error:
          "Pendaftaran gagal. Kode toko sementara bertabrakan - coba lagi dalam beberapa saat.",
      },
      { status: 500 },
    );
  }

  return Response.json(
    {
      ok: true,
      status: "pending",
      name,
      code,
      pin,
      message:
        "Pendaftaran diterima. Kode toko dan PIN kasir ditampilkan satu kali - catat sekarang.",
      nextStep:
        "Simpan kode dan PIN ini, lalu tunggu persetujuan admin. Toko belum bisa menerima pesanan sampai disetujui.",
    },
    { status: 201 },
  );
}

/**
 * Kode toko acak, format `TR` + 6 karakter huruf besar tanpa huruf yang
 * mudah tertukar.
 *
 * Alfabet 24 huruf (tanpa I, O, L, U, dan tanpa angka) supaya kode dibaca
 * keras-keras tanpa ambigu - kode ini diucapkan kasir dan ditulis pemilik
 * toko, jadi keterbacaan lebih penting dari ruang yang tersedia.
 */
function generateMerchantCode(): string {
  const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ";
  let body = "";
  for (let i = 0; i < 6; i += 1) {
    /*
     * `crypto.randomInt` sudah Lives di dalam modul lain yang di-import
     * (`merchant-pin`). Tapi di sini tidak perlu keamanan cryptographic -
     * yang penting distribusi seragam, dan `Math.random` cukup untuk itu. Yang
     * penting adalah TIDAK memakai `%` langsung, yang akan membuat huruf
     * awal jauh lebih sering muncul.
     */
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `TR${body}`;
}

/**
 * Keberadaan kode yang sudah dipakai dicek terpisah oleh pemanggil admin.
 * Di sini cukup satu percobaan; kalau tabrakan, insert gagal dan pemilik
 * toko tinggal mengulang - dan rate limit 5/jam menjaga agar pengulangan
 * tidak jadi alatision.
 */
export async function isMerchantCodeTaken(code: string): Promise<boolean> {
  const rows = await supabaseSelect<{ id: string }>("merchants", {
    select: "id",
    filters: { code: `eq.${code}` },
    limit: 1,
  });
  return rows.length > 0;
}