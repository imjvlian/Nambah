import { authorizeAdminRequest } from "@/lib/admin-api";
import { resolveReportRange } from "@/lib/report-range";
import { transactionsToCsv } from "@/lib/transaction-report-rules";
import {
  getAllTransactionsForExport,
  getTransactionReport,
} from "@/lib/transaction-report";

export const runtime = "nodejs";

/**
 * Laporan transaksi dengan detail item dan harga.
 *
 * Query parameter:
 *   `preset`     7 | 30 | 90  (dipakai kalau `from`/`to` tidak ada)
 *   `from`,`to`  rentang bebas `YYYY-MM-DD`
 *   `q`          pencarian bebas: id order, nama game, item, atau akun
 *   `status`     filter status order
 *   `payment`    filter metode pembayaran
 *   `offset`     untuk halaman berikutnya
 *   `format=csv` unduh semua baris terfilter sebagai CSV
 *
 * CSV memakai jalur pengambilan data yang BERBEDA dari tampilan: yang
 * tampilan dipaginasi 50 baris, yang CSV mengambil seluruh baris terfilter.
 * Kalau keduanya memakai jalur yang sama, file CSV hanya berisi halaman
 * pertama - dan operator akan menyimpulkan volume transaksinya lebih kecil
 * daripada kenyataan.
 */
export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const param = (key: string) => url.searchParams.get(key) ?? undefined;

  const range = resolveReportRange({
    preset: param("preset"),
    from: param("from"),
    to: param("to"),
  });

  const filters = {
    query: param("q"),
    status: param("status"),
    payment: param("payment"),
  };

  try {
    if (param("format") === "csv") {
      const exportData = await getAllTransactionsForExport({ range, filters });

      /*
       * Body dikirim sebagai BYTE, bukan string.
       *
       * `new Response(string)` mengikuti aturan fetch yang MENGHAPUS BOM
       * di depan body - jadi `\uFEFF` yang ditulis `transactionsToCsv`
       * tidak pernah sampai ke Excel, dan setiap karakter beraksen akan
       * tampil sebagai kotak. Mengirim `Uint8Array` lewat constructor
       * kedua membuat body diperlakukan sebagai byte mentah sehingga BOM
       * benar-benar terkirim.
       *
       * Perilaku ini sudah terverifikasi di route arus kas; diulang di
       * sini karena akan sangat mudah terlewat.
       */
      const csvBytes = new TextEncoder().encode(
        transactionsToCsv(exportData.rows, exportData.summary),
      );
      const stamp = `${range.from.toISOString().slice(0, 10)}_${range.to
        .toISOString()
        .slice(0, 10)}`;

      return new Response(csvBytes, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="transaksi_${stamp}.csv"`,
          "Content-Length": String(csvBytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }

    const report = await getTransactionReport({
      range,
      filters,
      offset: Number(param("offset") ?? 0),
      limit: Number(param("limit") ?? 50),
    });

    return Response.json({ ...report, from: range.from, to: range.to });
  } catch (error) {
    console.error("Transaction report failed", error);
    return Response.json(
      { error: "Laporan transaksi gagal dimuat." },
      { status: 502 },
    );
  }
}