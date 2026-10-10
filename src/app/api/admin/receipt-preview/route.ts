import {
  loadReceiptContext,
  renderReceiptHtml,
} from "@/lib/receipt-service";
import { authorizeAdminRequest } from "@/lib/admin-api";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

/**
 * Preview HTML receipt tanpa mengirim email.
 *
 * Dipakai dari panel admin untuk memeriksa tampilan receipt sebelum
 * dikirim ke pelanggan sungguhan. Penting karena email yang sudah masuk
 * inbox tidak bisa diedit — satu kesalahan layout akan terlihat oleh
 * pelanggan dan tidak bisa ditarik kembali.
 *
 * Menakal dua jalur render. Preview memanggil `renderReceiptHtml` yang
 * PERSIS sama dengan pengiriman sungguhan, bukan salinan terpisah. Kalau
 * ada dua implementasinya, preview hanya akan berbohong.
 *
 * Keamanan:
 * - `authorizeAdminRequest` menolak semua non-admin. Isinya adalah data
 *   transaksi milik orang lain, jadi tidak boleh terbuka hanya karena
 *   order ID berhasil ditebak.
 * - Hanya SELECT. Tidak menyentuh `receipt_deliveries`, jadi preview
 *   tidak pernah mengirim email atau mengubah status pengiriman.
 */
export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: `Database ${BRAND.shortName} belum dikonfigurasi.` },
      { status: 503 },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const orderId = searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) {
    return Response.json(
      { error: "Parameter orderId wajib diisi." },
      { status: 400 },
    );
  }

  /*
   * Mode unduh.
   *
   * Pratinjau dan unduh memakai FUNGSI render yang sama persis
   * (`renderReceiptHtml`), jadi berkas yang diunduh identik dengan yang
   * diterima pelanggan. Kalau nanti dipisah, pratinjau hanya akan berbohong.
   *
   * HTML dipilih, bukan PDF, dengan alasan yang disengaja: receipt dikirim
   * sebagai email HTML. PDF memerlukan pustaka baru dan hasilnya PASTI
   * berbeda dari yang pelanggan terima — persis kebalikan dari tujuan
   * pratinjau ini.
   */
  const wantsDownload = searchParams.get("download") === "1";

  /*
   * Sanitasi nama berkas — berlapis, bukan paranoia.
   *
   * `orderId` di sini SUDAH divalidasi secara tidak langsung: order harus
   * benar-benar ada di database, dan ID-nya dibuat sendiri oleh
   * `createOrderId()`. Order dengan ID berisi kutip atau CRLF tidak akan
   * pernah ketemu, jadi secara praktis tidak bisa sampai ke header.
   *
   * Tapi header `Content-Disposition` adalah tempat paling berbahaya untuk
   * nilai yang tidak dipercaya: CRLF di dalamnya bisa memecah respons
    * menjadi dua respons dan memungkinkan injeksi header. Jadi apa pun yang
   * lolos ke sini tetap disaring — murahan, dan mengubahnya nanti jadi
   * tidak perlu melihat ulang logika keamanan.
   */
  const safeFileName = orderId.replace(/[^A-Za-z0-9_-]/g, "");

  try {
    const context = await loadReceiptContext(orderId);

    if (!context) {
      return Response.json(
        { error: `Order ${orderId} tidak ditemukan.` },
        { status: 404 },
      );
    }

    // Order yang belum `success` tetap boleh di-preview. Justru di situ
    // preview paling berguna: admin bisa memeriksa receipt untuk order yang
    // masih berjalan tanpa menunggu sampai selesai.
    const html = renderReceiptHtml(context);

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        /*
         * `attachment` memaksa browser menyimpan berkas, bukan menampilkannya.
         *
         * Nama file memakai `orderId` yang SUDAH divalidasi: order ID dibuat
         * sendiri oleh `createOrderId()` (format `NBH-YYYYMMDD-XXXXXXXX`),
         * bukan input pengguna mentah. Kalau input dibiarkan bebas, nilai ini
         * bisa membawa CRLF dan memecah header — jadi jangan diganti tanpa
         * sanitasi eksplisit.
         */
        ...(wantsDownload && safeFileName
          ? {
              "Content-Disposition": `attachment; filename="receipt-${safeFileName}.html"`,
            }
          : {}),
        // Tidak di-cache: preview harus selalu mencerminkan data terbaru.
        "Cache-Control": "private, no-store",
        // Mencegah browser menebak-nebak tipe konten dan mencurangi
        // session cookie admin lewat content-type confusion.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Receipt preview failed", error);
    return Response.json(
      {
        error:
          "Preview gagal dirender. Order ini mungkin belum punya referensi katalog lengkap.",
      },
      { status: 503 },
    );
  }
}