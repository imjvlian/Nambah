import { authorizeAdminRequest } from "@/lib/admin-api";
import { cashFlowReportToCsv } from "@/lib/cash-flow-rules";
import { getCashFlowReport, resolveRange } from "@/lib/cash-flow";

export const runtime = "nodejs";

/**
 * Laporan arus kas.
 *
 * Dua format dari satu endpoint, dipilih lewat query `format`:
 *
 *   `format=json` (default) - untuk tampilan di panel admin.
 *   `format=csv`            - untuk diunduh dan dibuka di Excel.
 *
 * CSV dilayani dari route yang sama supaya definisi angkanya tidak pernah
 * bisa berbeda antara yang terlihat di layar dan yang diunduh. Kalau CSV
 * punya perhitungan sendiri, cepat atau lambat keduanya akan menyimpang -
 * dan yang diunduh justru tidak akan pernah dicek operator.
 */
export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const range = resolveRange({
    preset: url.searchParams.get("preset") ?? undefined,
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  try {
    const report = await getCashFlowReport(range);

    if (url.searchParams.get("format") === "csv") {
      const stamp = `${report.from.slice(0, 10)}_${report.to.slice(0, 10)}`;
      /*
       * Body dikirim sebagai BYTE, bukan string.
       *
       * Tanpa ini BOM hilang. `new Response(string)` membungkus body
       * menjadi UTF-8 lalu mengikuti aturan fetch yang MENGHAPUS BOM di
       * depan - jadi `cashFlowReportToCsv` boleh menulis `\uFEFF` di
       * awal, tapi karakter itu tidak pernah sampai ke Excel.
       *
       * Mengirim `Uint8Array` lewat constructor kedua membuat body
       * diperlakukan sebagai byte mentah, sehingga BOM benar-benar
       * terkirim. Tanpa BOM ini, Excel di Windows membaca file sebagai
       * ANSI dan setiap beraksen jadi kotak kosong.
       */
      const csvBytes = new TextEncoder().encode(cashFlowReportToCsv(report));

      return new Response(csvBytes, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="arus-kas_${stamp}.csv"`,
          "Content-Length": String(csvBytes.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json(report);
  } catch (error) {
    console.error("Cash flow report failed", error);
    return Response.json(
      { error: "Laporan arus kas gagal dimuat." },
      { status: 502 },
    );
  }
}