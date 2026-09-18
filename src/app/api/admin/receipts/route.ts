import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ReceiptRow = {
  id: number;
  order_id: string;
  channel: string;
  recipient: string;
  provider: string;
  status: string;
  provider_message_id: string | null;
  attempts: number | string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const rows = await supabaseSelect<ReceiptRow>("receipt_deliveries", {
      select:
        "id,order_id,channel,recipient,provider,status,provider_message_id,attempts,last_error,sent_at,created_at,updated_at",
      order: "created_at.desc",
      limit: 100,
    });

    return Response.json({
      receipts: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        channel: row.channel,
        recipient: maskEmail(row.recipient),
        provider: row.provider,
        status: row.status,
        providerMessageId: row.provider_message_id,
        attempts: Number(row.attempts || 0),
        lastError: row.last_error,
        sentAt: row.sent_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("Admin receipts failed", error);
    return Response.json(
      {
        error:
          "Log receipt tidak dapat dimuat. Pastikan migration receipt_deliveries sudah dijalankan.",
      },
      { status: 502 },
    );
  }
}
