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

  const [gameRows, productRows, paymentRows] = await Promise.all([
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
  ]);

  const game = gameRows[0];
  const product = productRows[0];
  const payment = paymentRows[0];

  if (!game || !product || !payment) {
    throw new Error(
      `Receipt context order ${orderId} tidak memiliki referensi katalog lengkap.`,
    );
  }

  return { order, game, product, payment };
}

function renderReceiptHtml(context: Awaited<ReturnType<typeof loadReceiptContext>>) {
  if (!context) throw new Error("Receipt context tidak tersedia.");

  const { order, game, product, payment } = context;
  const target = order.target_server_id
    ? `${order.target_user_id} (${order.target_server_id})`
    : order.target_user_id;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0d0a;color:#f4f6ef;font-family:Arial,sans-serif;">
    <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
      <div style="border:1px solid #252a22;border-radius:20px;background:#111310;overflow:hidden;">
        <div style="padding:24px;border-bottom:1px solid #252a22;">
          <div style="font-size:13px;font-weight:800;color:#c9ff3f;letter-spacing:.08em;text-transform:uppercase;">Nambah · Receipt</div>
          <h1 style="margin:14px 0 6px;font-size:28px;line-height:1.1;color:#f4f6ef;">Top up berhasil ✓</h1>
          <p style="margin:0;color:#939b8f;font-size:13px;line-height:1.6;">Pembayaran dan pemrosesan order kamu sudah selesai.</p>
        </div>

        <div style="padding:24px;">
          <table role="presentation" style="width:100%;border-collapse:collapse;color:#f4f6ef;font-size:13px;">
            <tr>
              <td style="padding:8px 0;color:#858d82;">Order ID</td>
              <td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(order.id)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#858d82;">Produk</td>
              <td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(game.name)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#858d82;">Nominal</td>
              <td style="padding:8px 0;text-align:right;">${escapeHtml(product.label)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#858d82;">Akun game</td>
              <td style="padding:8px 0;text-align:right;">${escapeHtml(target)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#858d82;">Pembayaran</td>
              <td style="padding:8px 0;text-align:right;">${escapeHtml(payment.name)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#858d82;">Selesai</td>
              <td style="padding:8px 0;text-align:right;">${escapeHtml(formatDate(order.fulfilled_at || order.paid_at))}</td>
            </tr>
          </table>

          <div style="margin-top:20px;padding-top:18px;border-top:1px solid #252a22;display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#939b8f;font-size:13px;">Total</span>
            <strong style="color:#c9ff3f;font-size:23px;">${escapeHtml(formatIDR(Number(order.final_price)))}</strong>
          </div>
        </div>

        <div style="padding:18px 24px;border-top:1px solid #252a22;color:#747c71;font-size:11px;line-height:1.6;">
          Simpan email ini sebagai bukti transaksi. Nambah tidak pernah meminta password atau OTP melalui receipt.
        </div>
      </div>
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
      subject: `Receipt Nambah · ${context.game.short_name} · ${orderId}`,
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
