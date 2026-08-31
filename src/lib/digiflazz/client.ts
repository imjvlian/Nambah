import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const BALANCE_URL = "https://api.digiflazz.com/v1/cek-saldo";
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

type DigiflazzErrorPayload = {
  message?: unknown;
  error?: unknown;
  rc?: unknown;
  response_code?: unknown;
};

export class DigiflazzApiError extends Error {
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(message: string, options?: { code?: string | null; retryable?: boolean }) {
    super(message);
    this.name = "DigiflazzApiError";
    this.code = options?.code ?? null;
    this.retryable = options?.retryable ?? false;
  }
}

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
    throw new DigiflazzApiError("Konfigurasi API Digiflazz belum lengkap.");
  }
  return config;
}

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function asNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function getDigiflazzErrorDetail(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { message: null as string | null, code: null as string | null };
  }

  const payload = value as DigiflazzErrorPayload;
  const message = asNonEmptyString(payload.message) ?? asNonEmptyString(payload.error);
  const code =
    asNonEmptyString(payload.rc) ??
    asNonEmptyString(payload.response_code) ??
    (typeof payload.rc === "number" ? String(payload.rc) : null) ??
    (typeof payload.response_code === "number" ? String(payload.response_code) : null);

  return { message, code };
}

function isLikelyRetryableDigiflazzMessage(message: string | null) {
  if (!message) return false;
  return /(limit|too many|rate|timeout|temporar|sementara|coba lagi|busy|maintenance)/i.test(message);
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
      throw new DigiflazzApiError(`Digiflazz mengembalikan response non-JSON (${response.status}).`, {
        retryable: response.status >= 500,
      });
    }

    if (!response.ok) {
      const detail = getDigiflazzErrorDetail(parsed);
      const codeLabel = detail.code ? ` [${detail.code}]` : "";
      const message = detail.message
        ? `Digiflazz request gagal${codeLabel}: ${detail.message}`
        : `Digiflazz request gagal (${response.status})${codeLabel}.`;

      throw new DigiflazzApiError(message, {
        code: detail.code,
        retryable:
          response.status === 429 ||
          response.status >= 500 ||
          isLikelyRetryableDigiflazzMessage(detail.message),
      });
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof DigiflazzApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DigiflazzApiError("Request ke Digiflazz timeout. Coba lagi beberapa saat lagi.", {
        retryable: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDigiflazzBalance() {
  const { username, apiKey } = requireApiConfig();
  const response = await postDigiflazz<{ data?: { deposit?: number | string } }>(BALANCE_URL, {
    cmd: "deposit",
    username,
    sign: md5(`${username}${apiKey}depo`),
  });

  const balance = Number(response.data?.deposit);
  if (!Number.isFinite(balance) || balance < 0) {
    throw new DigiflazzApiError("Response saldo Digiflazz tidak memiliki nilai deposit yang valid.");
  }

  return balance;
}

export async function getDigiflazzPrepaidPriceList(filters?: {
  code?: string;
  category?: string;
  brand?: string;
  type?: string;
}) {
  const { username, apiKey } = requireApiConfig();

  const response = await postDigiflazz<{
    data?: DigiflazzPriceItem[] | DigiflazzErrorPayload;
    message?: unknown;
    error?: unknown;
    rc?: unknown;
    response_code?: unknown;
  }>(PRICE_LIST_URL, {
    cmd: "prepaid",
    username,
    sign: md5(`${username}${apiKey}pricelist`),
    ...(filters?.code ? { code: filters.code } : {}),
    ...(filters?.category ? { category: filters.category } : {}),
    ...(filters?.brand ? { brand: filters.brand } : {}),
    ...(filters?.type ? { type: filters.type } : {}),
  });

  if (!Array.isArray(response.data)) {
    const detail = getDigiflazzErrorDetail(response.data ?? response);
    const codeLabel = detail.code ? ` [${detail.code}]` : "";
    const message = detail.message
      ? `Digiflazz menolak price-list${codeLabel}: ${detail.message}`
      : `Digiflazz mengembalikan format price-list yang tidak valid${codeLabel}.`;

    throw new DigiflazzApiError(message, {
      code: detail.code,
      retryable: isLikelyRetryableDigiflazzMessage(detail.message),
    });
  }

  return response.data;
}

export async function runDigiflazzPrepaidTransaction(input: {
  buyerSkuCode: string;
  customerNo: string;
  refId: string;
  maxPrice?: number;
  testing?: boolean;
  useCallback?: boolean;
}) {
  const { username, apiKey, callbackUrl } = requireApiConfig();
  const maxPrice = Number(input.maxPrice);

  const response = await postDigiflazz<{ data?: DigiflazzTransactionData }>(TRANSACTION_URL, {
    username,
    buyer_sku_code: input.buyerSkuCode,
    customer_no: input.customerNo,
    ref_id: input.refId,
    sign: md5(`${username}${apiKey}${input.refId}`),
    ...(Number.isFinite(maxPrice) && maxPrice > 0 ? { max_price: Math.round(maxPrice) } : {}),
    ...(typeof input.testing === "boolean" ? { testing: input.testing } : {}),
    ...(input.useCallback && callbackUrl ? { cb_url: callbackUrl } : {}),
  });

  if (!response.data) {
    throw new DigiflazzApiError("Response transaksi Digiflazz tidak memiliki data transaksi.");
  }

  return response.data;
}

export async function runDigiflazzTestTransaction(input: {
  outcome: DigiflazzTestOutcome;
  refId: string;
}) {
  const customerNo = TEST_TARGETS[input.outcome];
  return runDigiflazzPrepaidTransaction({
    buyerSkuCode: "xld10",
    customerNo,
    refId: input.refId,
    testing: true,
    maxPrice: 100_000,
    useCallback: true,
  });
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
