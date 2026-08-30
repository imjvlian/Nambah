import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PRICE_LIST_URL = "https://api.digiflazz.com/v1/price-list";
const TRANSACTION_URL = "https://api.digiflazz.com/v1/transaction";

export type DigiflazzPriceItem = {
  product_name: string;
  category: string;
  brand: string;
  type: string;
  seller_name: string;
  price: number | string;
  buyer_sku_code: string;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock: boolean;
  stock: number | string;
  multi: boolean;
  start_cut_off: string;
  end_cut_off: string;
  desc: string;
};

export type DigiflazzTransactionData = {
  ref_id: string;
  customer_no: string;
  buyer_sku_code: string;
  message: string;
  status: "Sukses" | "Pending" | "Gagal" | string;
  rc: string;
  sn?: string;
  buyer_last_saldo?: number;
  price: number;
  tele?: string;
  wa?: string;
};

export type DigiflazzWebhookPayload = {
  data?: DigiflazzTransactionData;
  [key: string]: unknown;
};

export type DigiflazzTestOutcome =
  | "success"
  | "failed"
  | "pending-success"
  | "pending-failed";

const TEST_TARGETS: Record<DigiflazzTestOutcome, string> = {
  success: "087800001230",
  failed: "087800001232",
  "pending-success": "087800001233",
  "pending-failed": "087800001234",
};

function getConfig() {
  return {
    username: process.env.DIGIFLAZZ_USERNAME?.trim() ?? "",
    apiKey: process.env.DIGIFLAZZ_API_KEY?.trim() ?? "",
    webhookSecret: process.env.DIGIFLAZZ_WEBHOOK_SECRET?.trim() ?? "",
    callbackUrl: process.env.DIGIFLAZZ_CALLBACK_URL?.trim() ?? "",
  };
}

export function isDigiflazzConfigured() {
  const { username, apiKey } = getConfig();
  return Boolean(username && apiKey);
}

function requireApiConfig() {
  const config = getConfig();
  if (!config.username || !config.apiKey) {
    throw new Error("Digiflazz API configuration is incomplete.");
  }
  return config;
}

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

async function postDigiflazz<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: unknown;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(`Digiflazz returned non-JSON response (${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(`Digiflazz request failed (${response.status}): ${raw}`);
    }

    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDigiflazzPrepaidPriceList(filters?: {
  code?: string;
  category?: string;
  brand?: string;
  type?: string;
}) {
  const { username, apiKey } = requireApiConfig();

  const response = await postDigiflazz<{ data?: DigiflazzPriceItem[] }>(PRICE_LIST_URL, {
    cmd: "prepaid",
    username,
    sign: md5(`${username}${apiKey}pricelist`),
    ...(filters?.code ? { code: filters.code } : {}),
    ...(filters?.category ? { category: filters.category } : {}),
    ...(filters?.brand ? { brand: filters.brand } : {}),
    ...(filters?.type ? { type: filters.type } : {}),
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Digiflazz price list response does not contain a data array.");
  }

  return response.data;
}

export async function runDigiflazzTestTransaction(input: {
  outcome: DigiflazzTestOutcome;
  refId: string;
}) {
  const { username, apiKey, callbackUrl } = requireApiConfig();
  const customerNo = TEST_TARGETS[input.outcome];

  const response = await postDigiflazz<{ data?: DigiflazzTransactionData }>(TRANSACTION_URL, {
    username,
    buyer_sku_code: "xld10",
    customer_no: customerNo,
    ref_id: input.refId,
    sign: md5(`${username}${apiKey}${input.refId}`),
    testing: true,
    max_price: 100_000,
    ...(callbackUrl ? { cb_url: callbackUrl } : {}),
  });

  if (!response.data) {
    throw new Error("Digiflazz transaction response does not contain data.");
  }

  return response.data;
}

export function verifyDigiflazzWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const { webhookSecret } = getConfig();
  if (!webhookSecret || !signatureHeader?.startsWith("sha1=")) return false;

  const expected = `sha1=${createHmac("sha1", webhookSecret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
