import { createHash, timingSafeEqual } from "node:crypto";

const SNAP_URLS = {
  sandbox: "https://app.sandbox.midtrans.com/snap/v1/transactions",
  production: "https://app.midtrans.com/snap/v1/transactions",
} as const;

const API_URLS = {
  sandbox: "https://api.sandbox.midtrans.com/v2",
  production: "https://api.midtrans.com/v2",
} as const;

export type MidtransEnvironment = "sandbox" | "production";

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

export function getMidtransEnvironment(): MidtransEnvironment {
  return process.env.MIDTRANS_ENVIRONMENT?.trim().toLowerCase() ===
    "production"
    ? "production"
    : "sandbox";
}

function getServerKey() {
  return process.env.MIDTRANS_SERVER_KEY?.trim() ?? "";
}

function requireServerKey() {
  const serverKey = getServerKey();
  if (!serverKey) {
    throw new Error("Midtrans server key belum dikonfigurasi.");
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
    throw new Error(
      `Midtrans returned non-JSON response (${response.status}).`,
    );
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error_messages" in parsed
        ? JSON.stringify(
            (parsed as { error_messages?: unknown }).error_messages,
          )
        : raw;
    throw new Error(
      `Midtrans request failed (${response.status}): ${message}`,
    );
  }

  return parsed as T;
}

export function isMidtransConfigured() {
  return Boolean(getServerKey());
}

// Backward-compatible export for older internal imports.
export function isMidtransSandboxConfigured() {
  return getMidtransEnvironment() === "sandbox" && isMidtransConfigured();
}

export async function createMidtransSnapTransaction(input: {
  orderId: string;
  grossAmount: number;
  itemId: string;
  itemName: string;
  enabledPayments: string[];
  customerEmail?: string;
  customerPhone?: string;
}) {
  const serverKey = requireServerKey();
  const environment = getMidtransEnvironment();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(SNAP_URLS[environment], {
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
        ...((input.customerEmail || input.customerPhone)
          ? {
              customer_details: {
                ...(input.customerEmail
                  ? { email: input.customerEmail }
                  : {}),
                ...(input.customerPhone
                  ? { phone: input.customerPhone }
                  : {}),
              },
            }
          : {}),
        expiry: {
          unit: "minutes",
          duration: 30,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const result = await readJsonResponse<{
      token?: string;
      redirect_url?: string;
    }>(response);

    if (!result.token || !result.redirect_url) {
      throw new Error(
        "Midtrans Snap response tidak memiliki token atau redirect_url.",
      );
    }

    return {
      token: result.token,
      redirectUrl: result.redirect_url,
      environment,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMidtransTransactionStatus(orderId: string) {
  const serverKey = requireServerKey();
  const environment = getMidtransEnvironment();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `${API_URLS[environment]}/${encodeURIComponent(orderId)}/status`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: authorizationHeader(serverKey),
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    return await readJsonResponse<MidtransStatusPayload>(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyMidtransNotificationSignature(
  payload: MidtransStatusPayload,
) {
  const serverKey = getServerKey();
  const orderId = payload.order_id ?? "";
  const statusCode = payload.status_code ?? "";
  const grossAmount = payload.gross_amount ?? "";
  const signature = payload.signature_key ?? "";

  if (!serverKey || !orderId || !statusCode || !grossAmount || !signature) {
    return false;
  }

  const expected = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}
