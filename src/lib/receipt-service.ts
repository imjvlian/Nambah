import {
  isBrevoConfigured,
  isBrevoReceiptEnabled,
  sendBrevoTransactionalEmail,
} from "@/lib/brevo/client";
import {
  supabaseSelect,
  supabaseUpdate,
  supabaseUpsert,
} from "@/lib/supabase/server";
import { notifyReceiptDeliveryFailed } from "@/lib/telegram-alerts";
import { BRAND } from "@/lib/brand";

type ReceiptOrderRow = {
  id: string;
  status: string;
  game_id: string;
  product_id: string;
  payment_method_id: string;
  target_user_id: string;
  target_server_id: string | null;
  receipt_email: string | null;
  final_price: number | string;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
};

type GameRow = {
  id: string;
  name: string;
  short_name: string;
};

type ProductRow = {
  id: string;
  label: string;
};

type PaymentMethodRow = {
  id: string;
  name: string;
};

type ReceiptDeliveryRow = {
  id: number;
  order_id: string;
  channel: "email" | "whatsapp";
  recipient: string;
  provider: string;
  status: "pending" | "sending" | "sent" | "failed";
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Baris transaksi supplier untuk satu order.
 *
 * Hanya `serial_number` yang diambil. Kolom lain (`cost`, `supplier_sku`,
 * `request_ref`) sengaja TIDAK masuk ke receipt: `cost` adalah margin
 * bisnis dan tidak boleh pernah terlihat oleh pelanggan.
 */
type SupplierTxRow = {
  serial_number: string | null;
};

export type ReceiptDeliveryResult = {
  orderId: string;
  status:
    | "disabled"
    | "not_configured"
    | "missing_recipient"
    | "not_ready"
    | "sending"
    | "sent"
    | "failed";
  messageId?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatIDR(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

async function getDelivery(orderId: string) {
  const [row] = await supabaseSelect<ReceiptDeliveryRow>(
    "receipt_deliveries",
    {
      select:
        "id,order_id,channel,recipient,provider,status,provider_message_id,attempts,last_error,sent_at,created_at,updated_at",
      filters: {
        order_id: `eq.${orderId}`,
        channel: "eq.email",
      },
      limit: 1,
    },
  );
  return row ?? null;
}

async function ensureDelivery(orderId: string, recipient: string) {
  const existing = await getDelivery(orderId);
  if (existing) return existing;

  const now = new Date().toISOString();
  await supabaseUpsert<ReceiptDeliveryRow>(
    "receipt_deliveries",
    {
      order_id: orderId,
      channel: "email",
      recipient,
      provider: "brevo",
      status: "pending",
      provider_message_id: null,
      attempts: 0,
      last_error: null,
      sent_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      onConflict: "order_id,channel",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );

  return await getDelivery(orderId);
}

async function loadReceiptContext(orderId: string) {
  const [order] = await supabaseSelect<ReceiptOrderRow>("orders", {
    select:
      "id,status,game_id,product_id,payment_method_id,target_user_id,target_server_id,receipt_email,final_price,paid_at,fulfilled_at,created_at",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });
  if (!order) return null;

  const [gameRows, productRows, paymentRows, supplierTxRows] = await Promise.all([
    supabaseSelect<GameRow>("games", {
      select: "id,name,short_name",
      filters: { id: `eq.${order.game_id}` },
      limit: 1,
    }),
    supabaseSelect<ProductRow>("products", {
      select: "id,label",
      filters: { id: `eq.${order.product_id}` },
      limit: 1,
    }),
    supabaseSelect<PaymentMethodRow>("payment_methods", {
      select: "id,name",
      filters: { id: `eq.${order.payment_method_id}` },
      limit: 1,
    }),
    /* SN (serial number) datang dari supplier, bukan dari tabel orders.
     *
     * `order: "created_at.desc"` itu penting: satu order bisa punya lebih
     * dari satu baris `supplier_transactions` (mis. setelah resync atau
     * percobaan ulang). Yang benar untuk ditampilkan adalah transaksi
     * TERAKHIR — itulah SN yang dipakai untuk fulfill.
     *
     * Kalau baris terbaru punya `serial_number` null (mis. transaksi
     * masih pending), receipt hanya akan menampilkan SN dari baris yang
     * memang punya nilai. Receipt dikirim hanya untuk order `success`,
     * jadi kasus itu seharusnya jarang. */
    supabaseSelect<SupplierTxRow>("supplier_transactions", {
      select: "serial_number",
      filters: { order_id: `eq.${orderId}` },
      order: "created_at.desc",
      limit: 1,
    }),
  ]);

  const game = gameRows[0];
  const product = productRows[0];
  const payment = paymentRows[0];

  if (!game || !product || !payment) {
    throw new Error(
      `Receipt context order ${orderId} tidak memiliki referensi katalog lengkap.`,
    );
  }

  // `supplierTxRows[0]` boleh undefined kalau order belum pernah menyentuh
  // supplier. Itu bukan error — SN hanya tidak ada untuk ditampilkan.
  const serialNumber = supplierTxRows[0]?.serial_number ?? null;

  return { order, game, product, payment, serialNumber };
}

/**
 * Render HTML receipt.
 *
 * BATASAN YANG MENDOMINASI DESAIN INI — bukan preferensi estetika:
 *
 * 1. **Semua style inline.** Gmail, Outlook, dan Yahoo memotong tag
 *    `<style>` di various titik. Inline style + atribut `bgcolor` adalah
 *    satu-satunya kombinasi yang selalu tampil.
 *
 * 2. **Warna gelap tidak esensial untuk tampilan, hanya untuk identitas.**
 *    Outlook.com (default di Outlook desktop) merender latar gelap dengan
 *    mode kompatibilitas yang sering membuang `border-radius` dan membuat
 *    teks jadi putih-di-atas-putih. Karena itu SETIAP elemen berwarna punya
 *    pasangan `bgcolor` — kalau gaya hilang, warnanya masih ada.
 *
 * 3. **Urutan informasi mengikuti urutan kepatentingan.**otpongan yang paling
 *    sering dicari user (order ID untuk contacting support, akun tujuan
 *    untuk memastikan tidak salah) berada di bagian yang terlihat tanpa
 *    scroll di layar 360px.
 *
 * 4. **Tidak ada logo eksternal, webfont, atau gambar.** Semuanya diblokir
 *    atau delay-nya tidak bisa diprediksi, dan receipt bisa dibaca Offline
 *    atau setelah gambar diblokir.
 */
function renderReceiptHtml(context: Awaited<ReturnType<typeof loadReceiptContext>>) {
  if (!context) throw new Error("Receipt context tidak tersedia.");

  const { order, game, product, payment, serialNumber } = context;
  const target = order.target_server_id
    ? `${order.target_user_id} (${order.target_server_id})`
    : order.target_user_id;

  // Dipisah supaya tidak dipotong `escapeHtml` — nilai ini masuk ke atribut
  // style, bukan ke teks, jadi tidak boleh lewat escape teks.
  const lime = BRAND.brandColor;
  const surface = "#111310";
  const page = "#0b0d0a";
  const border = "#252a22";

  return `<!doctype html>
<html lang="id" style="background:${page};">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Meminta client mode gelap untuk tidak meng-invert warna brand lime jadi
     biru. Tanpa ini, Apple Mail/Outlook bisa membalik #c9ff3f pada latar
     gelap dan brand jadi tidak terbaca. -->
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Receipt ${escapeHtml(BRAND.name)} · ${escapeHtml(order.id)}</title>
</head>
<!-- bgcolor adalah atribut HTML, BUKAN gaya. Outlook.com memotong CSS
     eksternal dan sering mengabaikan background-color di dalam style,
     tapi bgcolor tetap dipakai. Tanpa ini, receipt bisa tiba dengan
     latar putih dan teks putih di dalamnya — tidak terbaca sama sekali. -->
<body bgcolor="${page}" style="margin:0;padding:0;background:${page};background-color:${page};color:#f4f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <!-- Wrapper. Padding horizontal kecil supaya di layar 360px tidak ada
       scroll horizontal dari tabel. -->
  <div style="max-width:560px;margin:0 auto;padding:28px 16px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${surface}"
           style="border-collapse:separate;background:${surface};background-color:${surface};border:1px solid ${border};border-radius:20px;">

      <!-- ============ HEADER ============ -->
      <tr>
        <td style="padding:26px 26px 22px;border-bottom:1px solid ${border};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr>
              <td style="font-size:12px;font-weight:800;color:${lime};letter-spacing:.1em;text-transform:uppercase;line-height:1.4;">
                ${escapeHtml(BRAND.name)}
              </td>
              <td style="text-align:right;font-size:11px;color:#747c71;line-height:1.4;letter-spacing:.06em;text-transform:uppercase;">
                Receipt
              </td>
            </tr>
          </table>

          <!-- Badge sukses: teks, bukan ikon. Glyph seperti ✓ atau emoji
               dirender berbeda-beda antar client dan kadang jadi kotak
               kosong. Teks "SELESAI" selalu terbaca. -->
          <div style="margin-top:18px;display:inline-block;padding:5px 11px;border:1px solid ${lime};border-radius:999px;background-color:rgba(201,255,63,.1);font-size:11px;font-weight:800;color:${lime};letter-spacing:.08em;text-transform:uppercase;">
            Transaksi selesai
          </div>

          <h1 style="margin:14px 0 6px;font-size:26px;line-height:1.2;color:#f4f6ef;font-weight:800;">
            ${escapeHtml(game.name)}
          </h1>
          <p style="margin:0;font-size:15px;line-height:1.5;color:#b9c0b4;">
            ${escapeHtml(product.label)}
          </p>
        </td>
      </tr>

      <!-- ============ ORDER ID ============
           Dipisah dari tabel detail karena ini yang paling sering dicari
           saat menghubungi support, dan harus bisa disalin. Monospace +
           letter-spacing supaya tidak tertukar dengan huruf mirip
           (0/O, 1/l) saat diketik ulang. -->
      <tr>
        <td style="padding:20px 26px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 bgcolor="#161913" style="border-collapse:collapse;background:#161913;background-color:#161913;border-radius:12px;">
            <tr>
              <td style="padding:13px 15px;">
                <div style="font-size:10px;font-weight:700;color:#747c71;letter-spacing:.08em;text-transform:uppercase;">
                  Order ID
                </div>
                <div style="margin-top:5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;font-weight:700;color:#f4f6ef;letter-spacing:.06em;word-break:break-all;">
                  ${escapeHtml(order.id)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ============ SN / SERIAL NUMBER ============
           Hanya dirender kalau ada. SN datang dari supplier (Digiflazz),
           dan produk seperti pulsa atau voucher kadang memang tidak
           punya serial — memaksakan baris kosong hanya menambah ruang
           kosong tanpa informasi.

           Posisi di bawah Order ID, bukan di tabel detail, karena SN
           adalah BUKTI bahwa top up benar-benar masuk ke akun. Itu
           informasi yang dicari user paling pertama saat menanyakan
           "sudah masuk belum?" — bukan pembayaran atau tanggal. -->
      ${
    serialNumber
      ? `<tr>
        <td style="padding:10px 26px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 bgcolor="#161913" style="border-collapse:collapse;background:#161913;background-color:#161913;border-radius:12px;">
            <tr>
              <td style="padding:13px 15px;">
                <div style="font-size:10px;font-weight:700;color:#747c71;letter-spacing:.08em;text-transform:uppercase;">
                  SN / Serial number
                </div>
                <div style="margin-top:5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:#f4f6ef;letter-spacing:.04em;word-break:break-all;line-height:1.5;">
                  ${escapeHtml(serialNumber)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
      : ""
  }

      <!-- ============ DETAIL ============ -->
      <tr>
        <td style="padding:20px 26px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="border-collapse:collapse;font-size:13px;line-height:1.6;">
            <tr>
              <td style="padding:7px 0;color:#858d82;width:38%;vertical-align:top;">Akun game</td>
              <td style="padding:7px 0;color:#f4f6ef;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;">
                ${escapeHtml(target)}
              </td>
            </tr>
            <tr>
              <td style="padding:7px 0;color:#858d82;vertical-align:top;">Metode bayar</td>
              <td style="padding:7px 0;color:#f4f6ef;text-align:right;">${escapeHtml(payment.name)}</td>
            </tr>
            <tr>
              <td style="padding:7px 0;color:#858d82;vertical-align:top;">Dibuat</td>
              <td style="padding:7px 0;color:#f4f6ef;text-align:right;">${escapeHtml(formatDate(order.created_at))}</td>
            </tr>
            <tr>
              <td style="padding:7px 0;color:#858d82;vertical-align:top;">Selesai</td>
              <td style="padding:7px 0;color:#f4f6ef;text-align:right;">${escapeHtml(formatDate(order.fulfilled_at || order.paid_at))}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ============ TOTAL ============
           Block terpisah, bukan baris tabel. Ini angka yang dicari user,
           jadi harus punya hierarki visual sendiri — bukan sekadar bold
           di antara label lain. -->
      <tr>
        <td style="padding:22px 26px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="border-collapse:collapse;border-top:1px solid ${border};">
            <tr>
              <td style="padding:16px 0 0;font-size:13px;color:#939b8f;">Total dibayar</td>
              <td style="padding:16px 0 0;text-align:right;font-size:26px;font-weight:800;color:${lime};letter-spacing:-.02em;line-height:1.1;">
                ${escapeHtml(formatIDR(Number(order.final_price)))}
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ============ CATATAN KEAMANAN ============
           Ini bagian anti-phishing, dan itu alasan email ini ada selain
           bukti transaksi. ${BRAND.name} tidak pernah minta password —
           jadi kalimat itu harus terbaca, bukan jadi teks kaki 10px yang
           dilewati.

           Warna lime dipakai sebagai ACCENT, bukan warna utama: kalau
           catatan ini memakai warna brand penuh, ia akan terbaca seperti
           tombol CTA, dan justru menurunkan nilainya sebagai peringatan. -->
      <tr>
        <td style="padding:0 26px 26px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 bgcolor="#161913" style="border-collapse:collapse;background:#161913;background-color:#161913;border-left:2px solid ${lime};border-radius:0 10px 10px 0;">
            <tr>
              <td style="padding:14px 16px;font-size:12px;line-height:1.65;color:#b9c0b4;">
                <strong style="color:${lime};">Simpan email ini</strong> sebagai bukti transaksi.
                ${escapeHtml(BRAND.name)} tidak pernah meminta password, kode OTP,
                atau PIN melalui email. Kalau ada yang menghubungi kamu dengan
                alasan seperti itu, abaikan.
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ============ FOOTER ============ -->
      <tr>
        <td bgcolor="#0e100d" style="padding:16px 26px;background:#0e100d;background-color:#0e100d;border-radius:0 0 19px 19px;border-top:1px solid ${border};font-size:11px;line-height:1.6;color:#747c71;">
          ${escapeHtml(BRAND.name)} · ${escapeHtml(BRAND.tagline)}
        </td>
      </tr>

    </table>
  </div>
</body>
</html>`;
}

export async function deliverSuccessReceipt(
  orderId: string,
): Promise<ReceiptDeliveryResult> {
  if (!isBrevoReceiptEnabled()) {
    return { orderId, status: "disabled" };
  }

  if (!isBrevoConfigured()) {
    return { orderId, status: "not_configured" };
  }

  const context = await loadReceiptContext(orderId);
  if (!context || context.order.status !== "success") {
    return { orderId, status: "not_ready" };
  }

  const recipient = context.order.receipt_email?.trim().toLowerCase() ?? "";
  if (!recipient) {
    return { orderId, status: "missing_recipient" };
  }

  const existing = await ensureDelivery(orderId, recipient);
  if (!existing) {
    throw new Error(`Receipt delivery row gagal dibuat untuk ${orderId}.`);
  }

  if (existing.status === "sent") {
    return {
      orderId,
      status: "sent",
      ...(existing.provider_message_id
        ? { messageId: existing.provider_message_id }
        : {}),
    };
  }

  // A row left in "sending" is intentionally not auto-retried. This closes
  // the dangerous crash window where Brevo may have accepted an email but the
  // app died before persisting messageId. A later reconciliation tool can
  // inspect Brevo logs before deciding whether to retry it.
  if (existing.status === "sending") {
    return { orderId, status: "sending" };
  }

  const now = new Date().toISOString();
  const claimed = await supabaseUpdate<ReceiptDeliveryRow>(
    "receipt_deliveries",
    {
      status: "sending",
      recipient,
      provider: "brevo",
      attempts: Number(existing.attempts || 0) + 1,
      last_error: null,
      updated_at: now,
    },
    {
      filters: {
        order_id: `eq.${orderId}`,
        channel: "eq.email",
        status: "in.(pending,failed)",
      },
    },
  );

  if (claimed.length === 0) {
    const current = await getDelivery(orderId);
    return {
      orderId,
      status: current?.status === "sent" ? "sent" : "sending",
      ...(current?.provider_message_id
        ? { messageId: current.provider_message_id }
        : {}),
    };
  }

  try {
    const result = await sendBrevoTransactionalEmail({
      to: recipient,
      subject: `Receipt ${BRAND.shortName} · ${context.game.short_name} · ${orderId}`,
      htmlContent: renderReceiptHtml(context),
      tags: ["nambah-receipt", "order-success"],
    });

    const sentAt = new Date().toISOString();
    await supabaseUpdate(
      "receipt_deliveries",
      {
        status: "sent",
        provider_message_id: result.messageId,
        sent_at: sentAt,
        updated_at: sentAt,
      },
      {
        filters: {
          order_id: `eq.${orderId}`,
          channel: "eq.email",
          status: "eq.sending",
        },
      },
    );

    return {
      orderId,
      status: "sent",
      messageId: result.messageId,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Brevo receipt gagal dikirim.";

    await supabaseUpdate(
      "receipt_deliveries",
      {
        status: "failed",
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      },
      {
        filters: {
          order_id: `eq.${orderId}`,
          channel: "eq.email",
          status: "eq.sending",
        },
      },
    );

    console.error(`Receipt email failed for order ${orderId}`, error);

    try {
      await notifyReceiptDeliveryFailed(orderId, "email", message);
    } catch (alertError) {
      // Alert tidak boleh menutupi status kegagalan yang baru disimpan.
      console.error(`Receipt Telegram alert failed for order ${orderId}`, alertError);
    }

    return { orderId, status: "failed" };
  }
}


function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export async function getReceiptDeliveryStatus(orderId: string) {
  const context = await loadReceiptContext(orderId);
  const delivery = await getDelivery(orderId);

  return {
    orderId,
    orderStatus: context?.order.status ?? null,
    hasRecipient: Boolean(context?.order.receipt_email),
    recipient: context?.order.receipt_email
      ? maskEmail(context.order.receipt_email)
      : null,
    delivery: delivery
      ? {
          channel: delivery.channel,
          provider: delivery.provider,
          status: delivery.status,
          attempts: Number(delivery.attempts || 0),
          providerMessageId: delivery.provider_message_id,
          lastError: delivery.last_error,
          sentAt: delivery.sent_at,
          updatedAt: delivery.updated_at,
        }
      : null,
  };
}
