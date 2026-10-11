import { MelostoreSupplierClient } from "@/lib/suppliers/melostore-client";
import { MelostoreStatusService } from "@/lib/suppliers/melostore-status";
import { supabaseInsert } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Callback dari Melostore H2H.
 *
 * PATHNYA TIDAK IKUT POLA DIGIFLAZZ
 *
 * Yang lain ada di `/api/webhooks/digiflazz`. Yang ini di `/api/h2h-webhook`
 * karena URL itu sudah terdaftar di dashboard Melostore dan tidak bisa diubah
 * tanpa Rotate Keys - yang sekaligus mengganti API Key, Secret Key, dan
 * Webhook Secret. Memindahkan route berarti membatalkan kredensial yang
 * baru saja dibuat.
 *
 * Tiga aturan yang tidak bisa dilanggar, mengikuti pola
 * webhook Digiflazz:
 *
 * 1. Tanda tangan diverifikasi terhadap RAW BODY, sebelum parse. Kalau
 *    payload di-parse dulu dan di-`JSON.stringify` ulang untuk verifikasi,
 *    urutan key atau format angkanya bisa berubah dan verifikasi gagal
 *    tanpa alasan - atau, lebih buruk, lolos untuk body yang bukan yang
 *    dikirim.
 *
 * 2. Callback yang valid tapi sengaja diabaikan tetap dibalas 200.
 *    Melostore mengirim ulang callback yang mendapat 4xx/5xx. Membalas
 *    200 untuk event yang tidak dikenal akan menghentikan pengulangan;
 *    membalas 503 akan membuatnya mencoba terus sampai rate limit habis.
 *
 * 3. Semua callback tersimpan dulu, termasuk yang duplikat. Itu satu-satunya
 *    jejak ketika ada order yang_statusnya tidak sinkron dengan supplier.
 */

const client = new MelostoreSupplierClient();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-h2h-signature");

  if (!client.verifyWebhook(rawBody, signature)) {
    return Response.json(
      { error: "Tanda tangan webhook tidak valid." },
      { status: 401 },
    );
  }

  const event = client.parseWebhook(rawBody);
  if (!event) {
    /*
     * 400, bukan 200.
     *
     * Payload yang sudah ditandatangani tapi tidak bisa diparse berarti
     * ada sesuatu yang salah di sisi Melostore atau di parser kita - dan
     * itu layak ketahuan. 200 di sini akan menyembunyikannya di balik
     * "penerimaan diam-diam".
     */
    return Response.json(
      { error: "Payload webhook Melostore tidak dikenali." },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const parsedBody = safeParse(rawBody);
  const eventType =
    parsedBody && typeof parsedBody === "object"
      ? ((parsedBody as { event?: string }).event ?? "transaction.status")
      : "transaction.status";

  /*
   * Simpan dulu, sebelum efek bisnis apa pun.
   *
   * Kalau penyimpanan gagal, callback tidak boleh diterapkan tanpa jejak:
   * order akan berubah status sementara tabel audit tidak punya barisnya,
   * dan selisih itu tidak akan pernah ketahuan.
   */
  try {
    await supabaseInsert("supplier_webhook_events", {
      supplier_id: "melostore",
      event_type: eventType,
      request_ref: event.requestRef,
      status: event.status,
      user_agent: userAgent,
      payload: parsedBody ?? {},
      /*
       * event_key, supaya callback yang
       * sama bisa dideteksi duplikat lewat unique constraint.
       *
       * Kolom ini ditambahkan di migrasi 042. Kalau belum ada, sisipan
       * akan gagal dan callback dibalas 503 - yang terlihat seperti
       * Melostore yang salah, padahal migrasinya yang belum dijalankan.
       */
      event_key: event.eventKey,
    });
  } catch (error) {
    /*
     * PGRST204 = kolom `event_key` belum ada.
     *
     * Kode ini HANYA muncul kalau migrasi 042 belum dijalankan.
     * Pesan generik "gagal disimpan" akan membuat operator menunggu
     * sementara masalahnya sebenarnya sederhana: satu ALTER TABLE.
     * spécial : code ini HANYA muncul kalau migrasi 042 belum dijalankan.
     * Pesan generik "gagal disimpan" akan membuat operator menunggu
     * sementara masalahnya sebenarnya shortfall: satu ALTER TABLE.
     *
     * Status 503 supaya Melostore mengirim ulang - dan setelah migrasi
     * dijalankan, callback yang tertunda itu akan diterima seperti biasa.
     */
    const detail = error instanceof Error ? error.message : String(error);
    const kolomBelumAda = /PGRST204|event_key/.test(detail);

    console.error(
      kolomBelumAda
        ? "Migrasi 042 belum dijalankan: kolom event_key belum ada."
        : "Gagal menyimpan webhook Melostore",
      error,
    );

    return Response.json(
      {
        received: true,
        error: kolomBelumAda
          ? "Kolom event_key belum ada. Jalankan migrasi 042."
          : "Webhook diterima tetapi gagal disimpan.",
      },
      { status: 503 },
    );
  }

  /*
   * Event tindakan (2FA) dicatat tapi TIDAK boleh menyelesaikan order.
   *
   * Dokumentasi Melostore menyatakannya eksplisit: event tindakan tidak
   * boleh menyelesaikan pesanan, mengubah saldo, atau memicu refund. Kalau
   * event ini diterapkan seperti hasil akhir, order akan ditandai selesai
   * padahal masih menunggu kode verifikasi pembeli.
   */
  if (event.requiresAction) {
    console.warn("Melostore action callback diterima, tidak diterapkan ke status order", {
      requestRef: event.requestRef,
      eventKey: event.eventKey,
    });
    return Response.json({
      received: true,
      applied: false,
      reason: "requires_action",
      requestRef: event.requestRef,
    });
  }

  try {
    const result = await MelostoreStatusService.apply(event);

    if (
      result.reason === "unknown_request_ref" ||
      result.reason === "unsupported_status" ||
      result.reason === "supplier_terminal_conflict" ||
      result.reason === "order_missing" ||
      result.reason === "duplicate"
    ) {
      console.warn("Callback Melostore diabaikan", result);
    }

    return Response.json({
      received: true,
      applied: result.applied,
      reason: result.reason,
      requestRef: result.requestRef,
      orderId: result.orderId,
      supplierStatus: result.supplierTransactionStatus,
      orderStatus: result.orderStatus,
      receiptTriggered: result.receiptTriggered,
    });
  } catch (error) {
    console.error("Penerapan status Melostore gagal", error);
    return Response.json(
      {
        received: true,
        error: "Webhook tersimpan tetapi status supplier gagal diterapkan.",
      },
      { status: 503 },
    );
  }
}

function safeParse(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}