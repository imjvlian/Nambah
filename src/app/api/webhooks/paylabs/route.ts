import { applyPaylabsStatus } from "@/lib/order-service";
import {
  createPaylabsSignature,
  getPaylabsConfig,
  getPaylabsNotificationPath,
  paylabsTimestamp,
  verifyPaylabsSignature,
} from "@/lib/payments/paylabs";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const WEBHOOK_PATH = "/api/webhooks/paylabs";

type PaylabsNotificationBody = {
  requestId?: string;
  merchantId?: string;
  storeId?: string;
  paymentType?: string;
  amount?: string | number;
  merchantTradeNo?: string;
  platformTradeNo?: string;
  status?: string;
  successTime?: string;
  createTime?: string;
  [key: string]: unknown;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ errCode: "503", errCodeDes: "Database belum dikonfigurasi." }, { status: 503 });
  }

  const config = getPaylabsConfig();
  if (!config) {
    return Response.json({ errCode: "503", errCodeDes: "Paylabs belum dikonfigurasi." }, { status: 503 });
  }

  const rawBody = await request.text();
  const notificationPath = getPaylabsNotificationPath(WEBHOOK_PATH);
  const timestamp = request.headers.get("x-timestamp");
  const signature = request.headers.get("x-signature");

  if (config.publicKey) {
    const valid = verifyPaylabsSignature({
      method: "POST",
      path: notificationPath,
      body: rawBody,
      timestamp,
      signature,
      publicKey: config.publicKey,
    });
    if (!valid) {
      return Response.json({ errCode: "401", errCodeDes: "Signature tidak valid." }, { status: 401 });
    }
  }

  let payload: PaylabsNotificationBody;
  try {
    payload = JSON.parse(rawBody) as PaylabsNotificationBody;
  } catch {
    return Response.json({ errCode: "400", errCodeDes: "Payload tidak valid." }, { status: 400 });
  }

  const orderId = payload.merchantTradeNo?.trim() ?? "";
  if (!orderId) {
    return Response.json({ errCode: "400", errCodeDes: "merchantTradeNo kosong." }, { status: 400 });
  }

  try {
    const order = await applyPaylabsStatus(
      {
        orderId,
        platformTradeNo: payload.platformTradeNo?.trim() ?? null,
        status: payload.status ?? null,
        paidTime: payload.successTime ?? payload.createTime ?? null,
        amountValue: payload.amount ?? null,
        paymentType: payload.paymentType ?? null,
        raw: payload,
      },
      "webhook",
      Boolean(config.publicKey),
    );

    const responseTimestamp = paylabsTimestamp();
    const responseBody = {
      merchantId: payload.merchantId ?? config.merchantId,
      requestId: payload.requestId ?? orderId,
      errCode: "0",
      errCodeDes: "Success",
    };
    const responseSignature = createPaylabsSignature({
      method: "POST",
      path: notificationPath,
      body: responseBody,
      timestamp: responseTimestamp,
      privateKey: config.privateKey,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-TIMESTAMP": responseTimestamp,
        "X-SIGNATURE": responseSignature,
        "X-PARTNER-ID": config.partnerId,
        "X-REQUEST-ID": String(responseBody.requestId),
      },
    });
  } catch (error) {
    console.error("Paylabs webhook processing failed", error);
    return Response.json(
      { errCode: "503", errCodeDes: "Webhook gagal diproses." },
      { status: 503 },
    );
  }
}

