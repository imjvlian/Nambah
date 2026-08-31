import { createHash, timingSafeEqual } from "node:crypto";

const SNAP_SANDBOX_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const API_SANDBOX_URL = "https://api.sandbox.midtrans.com/v2";

export type MidtransStatusPayload = {
  order_id?: string;
  transaction_id?: string;
  transaction_status?: string;
  status_code?: string;
  status_message?: string;
  gross_amount?: string;
  payment_type?: string;
  fraud_status?: string;
  signature_key?: string;
  settlement_time?: string;
  transaction_time?: string;
  [key: string]: unknown;
};

function getServerKey() {
  return process.env.MIDTRANS_SERVER_KEY?.trim() ?? "";
}

function requireServerKey() {
  const serverKey = getServerKey();
  if (!serverKey) {
    throw new Error("Midtrans Sandbox server key belum dikonfigurasi.");
  }
  return serverKey;
}

function authorizationHeader(serverKey: string) {
  return `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let parsed: unknown;

  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Midtrans returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error_messages" in parsed
        ? JSON.stringify((parsed as { error_messages?: unknown }).error_messages)
        : raw;
    throw new Error(`Midtrans request failed (${response.status}): ${message}`);
  }

  return parsed as T;
}

export function isMidtransSandboxConfigured() {
  return Boolean(getServerKey());
}

export async function createMidtransSnapTransaction(input: {
  orderId: string;
  grossAmount: number;
  itemId: string;
  itemName: string;
  enabledPayments: string[];
}) {
  const serverKey = requireServerKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(SNAP_SANDBOX_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorizationHeader(serverKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: input.orderId,
          gross_amount: input.grossAmount,
        },
        item_details: [
          {
            id: input.itemId,
            price: input.grossAmount,
            quantity: 1,
            name: input.itemName.slice(0, 50),
            category: "Digital Goods",
            merchant_name: "Nambah",
          },
        ],
        enabled_payments: input.enabledPayments,
        expiry: {
          unit: "minutes",
          duration: 30,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const result = await readJsonResponse<{ token?: string; redirect_url?: string }>(response);
    if (!result.token || !result.redirect_url) {
      throw new Error("Midtrans Snap response tidak memiliki token atau redirect_url.");
    }

    return {
      token: result.token,
      redirectUrl: result.redirect_url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMidtransTransactionStatus(orderId: string) {
  const serverKey = requireServerKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${API_SANDBOX_URL}/${encodeURIComponent(orderId)}/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorizationHeader(serverKey),
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    return await readJsonResponse<MidtransStatusPayload>(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyMidtransNotificationSignature(payload: MidtransStatusPayload) {
  const serverKey = getServerKey();
  const orderId = payload.order_id ?? "";
  const statusCode = payload.status_code ?? "";
  const grossAmount = payload.gross_amount ?? "";
  const signature = payload.signature_key ?? "";

  if (!serverKey || !orderId || !statusCode || !grossAmount || !signature) return false;

  const expected = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
