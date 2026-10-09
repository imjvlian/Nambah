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

  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) {
    return Response.json(
      { error: "Parameter orderId wajib diisi." },
      { status: 400 },
    );
  }

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