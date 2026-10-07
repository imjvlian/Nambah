import {
  createHash,
  createHmac,
  randomUUID,
  sign as rsaSign,
  timingSafeEqual,
} from "node:crypto";
import { getDokuEnvironment } from "@/lib/payment-settings";
import type { CreatePaymentInput, PaymentSession } from "./types";

/**
 * Client DOKU Jokul SNAP (Standar Nasional OpenAPI Pembayaran).
 *
 * Autentikasi 2 lapis:
 * 1. Token B2B — signature asimetris SHA256withRSA(clientId|timestamp)
 *    memakai private key merchant; token berlaku 15 menit dan di-cache.
 * 2. Signature transaksi — HMAC-SHA512(clientSecret) atas
 *    HTTPMethod:EndpointUrl:AccessToken:LowercaseHex(SHA256(minifiedBody)):Timestamp
 */

const BASE_URLS = {
  sandbox: "https://api-sandbox.doku.com",
  production: "https://api.doku.com",
} as const;

const TOKEN_PATH = "/authorization/v1/access-token/b2b";
const QRIS_GENERATE_PATH = "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate";
const QRIS_QUERY_PATH = "/snap-adapter/b2b/v1.0/qr/qr-mpm-query";
const QRIS_SERVICE_CODE = "47";
/** QRIS host-to-host channel id mengikuti dokumentasi DOKU. */
const QRIS_CHANNEL_ID = "H2H";
/** QR dinamis default berlaku 30 menit — selaras expires_at order Nambah. */
const QRIS_VALIDITY_MINUTES = 30;

export type DokuSnapConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  merchantId: string;
  terminalId: string;
  postalCode: string;
  environment: "sandbox" | "production";
};

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function getDokuSnapConfig(): DokuSnapConfig | null {
  const clientId = env("DOKU_CLIENT_ID");
  const clientSecret = env("DOKU_SECRET_KEY");
  // Private key RSA merchant (PEM). Di Vercel biasanya disimpan dengan \n
  // literal — normalkan di sini.
  const privateKey = env("DOKU_PRIVATE_KEY").replace(/\\n/g, "\n");
  const merchantId = env("DOKU_MERCHANT_ID");
  const terminalId = env("DOKU_TERMINAL_ID");

  if (!clientId || !clientSecret || !privateKey || !merchantId || !terminalId) {
    return null;
  }

  const environment = getDokuEnvironment();
  // DOKU_BASE_URL (opsional) menimpa URL hasil mapping DOKU_ENV — berguna
  // untuk sandbox eksplisit atau endpoint custom dari DOKU.
  const baseUrl =
    env("DOKU_BASE_URL").replace(/\/+$/, "") || BASE_URLS[environment];
  return {
    baseUrl,
    clientId,
    clientSecret,
    privateKey,
    merchantId,
    terminalId,
    postalCode: env("DOKU_POSTAL_CODE") || "12190",
    environment,
  };
}

/**
 * Path Request-Target untuk verifikasi signature notifikasi. Diambil dari
 * DOKU_NOTIFICATION_URL (path-nya) supaya cocok dengan URL yang didaftarkan
 * di dashboard DOKU; fallback ke path route webhook internal.
 */
export function getDokuNotificationPath(fallback: string) {
  const url = env("DOKU_NOTIFICATION_URL");
  if (!url) return fallback;
  try {
    const pathname = new URL(url).pathname;
    return pathname || fallback;
  } catch {
    // Nilai bisa juga langsung berupa path ("/payments/doku/notification").
    return url.startsWith("/") ? url : fallback;
  }
}

export function isDokuSnapConfigured() {
  return getDokuSnapConfig() !== null;
}

/** ISO8601 UTC+0 tanpa milidetik — format X-TIMESTAMP SNAP. */
function snapTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sha256HexLower(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex").toLowerCase();
}

function minify(body: unknown) {
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Token B2B (asymmetric RSA)
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: DokuSnapConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.token;
  }

  const timestamp = snapTimestamp();
  const stringToSign = `${config.clientId}|${timestamp}`;
  const signature = rsaSign("RSA-SHA256", Buffer.from(stringToSign, "utf8"), config.privateKey).toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": config.clientId,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
      },
      body: minify({ grantType: "client_credentials" }),
      cache: "no-store",
      signal: controller.signal,
    });

    const result = (await response.json()) as {
      responseCode?: string;
      responseMessage?: string;
      accessToken?: string;
      expiresIn?: number | string;
    };

    if (!response.ok || !result.accessToken) {
      throw new Error(
        `DOKU token B2B gagal (${result.responseCode ?? response.status}): ${result.responseMessage ?? "tanpa pesan"}`,
      );
    }

    const expiresInSeconds = Number(result.expiresIn) || 900;
    cachedToken = {
      token: result.accessToken,
      expiresAt: now + expiresInSeconds * 1000,
    };
    return result.accessToken;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Signature transaksi (symmetric HMAC-SHA512)
// ---------------------------------------------------------------------------

export function buildSnapSignature(input: {
  method: string;
  path: string;
  accessToken: string;
  body: string;
  timestamp: string;
  clientSecret: string;
}) {
  const stringToSign = [
    input.method.toUpperCase(),
    input.path,
    input.accessToken,
    sha256HexLower(input.body),
    input.timestamp,
  ].join(":");

  return createHmac("sha512", input.clientSecret)
    .update(stringToSign, "utf8")
    .digest("base64");
}

/** X-EXTERNAL-ID: numeric string unik per hari sesuai spesifikasi SNAP. */
function externalId() {
  return `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
}

async function dokuSignedFetch<T>(
  config: DokuSnapConfig,
  input: { path: string; body: unknown },
): Promise<T> {
  const accessToken = await getAccessToken(config);
  const timestamp = snapTimestamp();
  const body = minify(input.body);
  const signature = buildSnapSignature({
    method: "POST",
    path: input.path,
    accessToken,
    body,
    timestamp,
    clientSecret: config.clientSecret,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${config.baseUrl}${input.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PARTNER-ID": config.clientId,
        "X-EXTERNAL-ID": externalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${accessToken}`,
        "CHANNEL-ID": QRIS_CHANNEL_ID,
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const result = (await response.json()) as T & {
      responseCode?: string;
      responseMessage?: string;
    };

    if (!response.ok) {
      throw new Error(
        `DOKU ${input.path} gagal (${result.responseCode ?? response.status}): ${result.responseMessage ?? "tanpa pesan"}`,
      );
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// QRIS
// ---------------------------------------------------------------------------

type QrisGenerateResponse = {
  responseCode?: string;
  responseMessage?: string;
  referenceNo?: string;
  partnerReferenceNo?: string;
  qrContent?: string;
  terminalId?: string;
  additionalInfo?: { validityPeriod?: string };
};

function formatAmount(amount: number) {
  return `${Math.round(amount)}.00`;
}

export async function createDokuQrisPayment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const config = getDokuSnapConfig();
  if (!config) {
    throw new Error("DOKU SNAP belum dikonfigurasi (CLIENT_ID/SECRET_KEY/PRIVATE_KEY/MERCHANT_ID/TERMINAL_ID).");
  }

  const validityPeriod = new Date(
    Date.now() + QRIS_VALIDITY_MINUTES * 60 * 1000,
  ).toISOString();

  const result = await dokuSignedFetch<QrisGenerateResponse>(config, {
    path: QRIS_GENERATE_PATH,
    body: {
      partnerReferenceNo: input.orderId,
      amount: { value: formatAmount(input.grossAmount), currency: "IDR" },
      merchantId: config.merchantId,
      terminalId: config.terminalId,
      validityPeriod,
      additionalInfo: { postalCode: config.postalCode, feeType: "1" },
    },
  });

  if (!result.qrContent || !result.referenceNo) {
    throw new Error(
      `DOKU QRIS tidak mengembalikan qrContent (${result.responseCode ?? "?"}: ${result.responseMessage ?? "tanpa pesan"}).`,
    );
  }

  return {
    provider: "doku",
    payload: {
      kind: "qris",
      qrContent: result.qrContent,
      expiresAt: result.additionalInfo?.validityPeriod ?? validityPeriod,
      raw: {
        referenceNo: result.referenceNo,
        partnerReferenceNo: result.partnerReferenceNo ?? input.orderId,
        terminalId: result.terminalId ?? config.terminalId,
      },
    },
  };
}

export type DokuTransactionStatus =
  | "settlement"
  | "pending"
  | "refund"
  | "cancel"
  | "failure";

/** Mapping kode status SNAP → status ternormalisasi gaya Midtrans. */
export function mapDokuTransactionStatus(code: string | undefined): DokuTransactionStatus {
  switch (code) {
    case "00":
      return "settlement";
    case "04":
      return "refund";
    case "05":
      return "cancel";
    case "06":
      return "failure";
    case "03":
    default:
      return "pending";
  }
}

export type DokuStatusResult = {
  orderId: string;
  referenceNo: string | null;
  transactionStatus: DokuTransactionStatus;
  transactionStatusDesc: string | null;
  paidTime: string | null;
  amountValue: string | null;
  raw: unknown;
};

type QrisQueryResponse = {
  responseCode?: string;
  responseMessage?: string;
  originalReferenceNo?: string;
  originalPartnerReferenceNo?: string;
  latestTransactionStatus?: string;
  transactionStatusDesc?: string;
  paidTime?: string;
  amount?: { value?: string; currency?: string };
};

export async function fetchDokuQrisStatus(input: {
  orderId: string;
  referenceNo: string | null;
}): Promise<DokuStatusResult> {
  const config = getDokuSnapConfig();
  if (!config) {
    throw new Error("DOKU SNAP belum dikonfigurasi.");
  }
  if (!input.referenceNo) {
    throw new Error("referenceNo DOKU untuk order ini tidak ditemukan.");
  }

  const result = await dokuSignedFetch<QrisQueryResponse>(config, {
    path: QRIS_QUERY_PATH,
    body: {
      originalReferenceNo: input.referenceNo,
      originalPartnerReferenceNo: input.orderId,
      serviceCode: QRIS_SERVICE_CODE,
      merchantId: config.merchantId,
    },
  });

  return {
    orderId: result.originalPartnerReferenceNo ?? input.orderId,
    referenceNo: result.originalReferenceNo ?? input.referenceNo,
    transactionStatus: mapDokuTransactionStatus(result.latestTransactionStatus),
    transactionStatusDesc: result.transactionStatusDesc ?? null,
    paidTime: result.paidTime ?? null,
    amountValue: result.amount?.value ?? null,
    raw: result,
  };
}

// ---------------------------------------------------------------------------
// Notifikasi (webhook masuk dari DOKU)
// ---------------------------------------------------------------------------

/**
 * Verifikasi X-SIGNATURE notifikasi SNAP masuk. ACCESS-TOKEN pada stringToSign
 * adalah bearer token yang dikirim DOKU pada header Authorization notifikasi;
 * Request-Target adalah PATH endpoint webhook kita sendiri.
 */
export function verifyDokuNotificationSignature(input: {
  method: string;
  path: string;
  authorizationHeader: string | null;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  const config = getDokuSnapConfig();
  if (!config) return false;

  const accessToken = (input.authorizationHeader ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!accessToken || !input.timestamp || !input.signature) return false;

  const expected = buildSnapSignature({
    method: input.method,
    path: input.path,
    accessToken,
    body: input.rawBody,
    timestamp: input.timestamp,
    clientSecret: config.clientSecret,
  });

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

// ===========================================================================
// NON-SNAP (Jokul klasik): Client-Id + Secret Key, signature HMAC-SHA256.
// Dipakai otomatis saat RSA keys SNAP belum tersedia — mencakup DOKU Checkout
// (hosted page semua channel) + check status + notifikasi.
// ===========================================================================

const CHECKOUT_CREATE_PATH = "/checkout/v1/payment";
const CHECKOUT_STATUS_PATH = "/orders/v1/status/";

export type DokuCheckoutConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
};

export function getDokuCheckoutConfig(): DokuCheckoutConfig | null {
  const clientId = env("DOKU_CLIENT_ID");
  const clientSecret = env("DOKU_SECRET_KEY");
  if (!clientId || !clientSecret) return null;

  const environment = getDokuEnvironment();
  return {
    baseUrl: env("DOKU_BASE_URL").replace(/\/+$/, "") || BASE_URLS[environment],
    clientId,
    clientSecret,
    environment,
  };
}

export type DokuMode = "snap" | "checkout";

/** Mode aktif berdasar kredensial yang tersedia: SNAP (native) > checkout. */
export function getDokuMode(): DokuMode | null {
  if (getDokuSnapConfig()) return "snap";
  if (getDokuCheckoutConfig()) return "checkout";
  return null;
}

function sha256Base64(text: string) {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

function buildNonSnapSignature(input: {
  clientId: string;
  requestId: string;
  timestamp: string;
  target: string;
  /** Body mentah; GET tidak menyertakan Digest. */
  rawBody?: string | null;
  clientSecret: string;
}) {
  const lines = [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.timestamp}`,
    `Request-Target:${input.target}`,
  ];
  if (input.rawBody !== null && input.rawBody !== undefined) {
    lines.push(`Digest:${sha256Base64(input.rawBody)}`);
  }
  const signature = createHmac("sha256", input.clientSecret)
    .update(lines.join("\n"), "utf8")
    .digest("base64");
  return `HMACSHA256=${signature}`;
}

type CheckoutCreateResponse = {
  message?: string[];
  response?: {
    order?: { invoice_number?: string; session_id?: string };
    payment?: {
      token_id?: string;
      url?: string;
      expired_date?: string; // yyyyMMddHHmmss UTC+7
    };
  };
  error_messages?: string[];
};

/** expired_date DOKU: yyyyMMddHHmmss UTC+7 → ISO string. */
function parseDokuExpiredDate(value?: string) {
  if (!value || value.length !== 14) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Channel DOKU Checkout yang dipetakan dari metode Nambah. */
function checkoutMethodTypes(input: CreatePaymentInput): string[] | null {
  const method = input.paymentMethodId.toLowerCase();
  if (method.includes("qris")) return ["QRIS"];
  if (method === "va" || method.includes("virtual")) {
    return [
      "VIRTUAL_ACCOUNT_BCA",
      "VIRTUAL_ACCOUNT_BRI",
      "VIRTUAL_ACCOUNT_BNI",
      "VIRTUAL_ACCOUNT_BANK_MANDIRI",
      "VIRTUAL_ACCOUNT_BANK_PERMATA",
      "VIRTUAL_ACCOUNT_BANK_CIMB",
      "VIRTUAL_ACCOUNT_DOKU",
    ];
  }
  if (method.includes("ewallet") || method.includes("e-wallet") || method.includes("emoney")) {
    return ["EMONEY_OVO", "EMONEY_DANA", "EMONEY_SHOPEE_PAY", "EMONEY_LINKAJA"];
  }
  return null;
}

export async function createDokuCheckoutPayment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const config = getDokuCheckoutConfig();
  if (!config) {
    throw new Error("DOKU Checkout belum dikonfigurasi (DOKU_CLIENT_ID / DOKU_SECRET_KEY).");
  }

  const requestId = randomUUID();
  const timestamp = snapTimestamp();
  const methodTypes = checkoutMethodTypes(input);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const notificationUrl = env("DOKU_NOTIFICATION_URL");

  const body = minify({
    order: {
      amount: Math.round(input.grossAmount),
      invoice_number: input.orderId,
      ...(siteUrl ? { callback_url: `${siteUrl}/order/${input.orderId}` } : {}),
    },
    payment: {
      payment_due_date: 30,
      ...(methodTypes ? { payment_method_types: methodTypes } : {}),
    },
    ...(input.customerEmail || input.customerPhone
      ? {
          customer: {
            ...(input.customerEmail ? { email: input.customerEmail } : {}),
            ...(input.customerPhone ? { phone: input.customerPhone } : {}),
          },
        }
      : {}),
    ...(notificationUrl
      ? { additional_info: { override_notification_url: notificationUrl } }
      : {}),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${config.baseUrl}${CHECKOUT_CREATE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": config.clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: buildNonSnapSignature({
          clientId: config.clientId,
          requestId,
          timestamp,
          target: CHECKOUT_CREATE_PATH,
          rawBody: body,
          clientSecret: config.clientSecret,
        }),
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const result = (await response.json()) as CheckoutCreateResponse;
    const url = result.response?.payment?.url;
    if (!response.ok || !url) {
      throw new Error(
        `DOKU Checkout gagal (${response.status}): ${(result.error_messages ?? result.message ?? ["tanpa pesan"]).join(", ")}`,
      );
    }

    return {
      provider: "doku",
      payload: {
        kind: "redirect",
        redirectUrl: url,
        expiresAt: parseDokuExpiredDate(result.response?.payment?.expired_date),
        raw: {
          mode: "checkout",
          requestId,
          sessionId: result.response?.order?.session_id ?? null,
          tokenId: result.response?.payment?.token_id ?? null,
        },
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

type CheckoutStatusResponse = {
  order?: { invoice_number?: string; amount?: number | string };
  transaction?: {
    status?: string;
    date?: string;
    original_request_id?: string;
  };
  channel?: { id?: string };
  error_messages?: string[];
};

/** Mapping status non-SNAP (Checkout) → status ternormalisasi gaya Midtrans. */
export function mapDokuCheckoutStatus(status: string | undefined): DokuTransactionStatus {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
      return "settlement";
    case "REFUNDED":
      return "refund";
    case "EXPIRED":
    case "VOIDED":
      return "cancel";
    case "FAILED":
      return "failure";
    case "PENDING":
    case "TIMEOUT":
    case "REDIRECT":
    default:
      return "pending";
  }
}

export async function fetchDokuCheckoutStatus(
  orderId: string,
): Promise<DokuStatusResult> {
  const config = getDokuCheckoutConfig();
  if (!config) {
    throw new Error("DOKU Checkout belum dikonfigurasi.");
  }

  const target = `${CHECKOUT_STATUS_PATH}${encodeURIComponent(orderId)}`;
  const requestId = randomUUID();
  const timestamp = snapTimestamp();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}${target}`, {
      method: "GET",
      headers: {
        "Client-Id": config.clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        // GET: tanpa Digest pada component string.
        Signature: buildNonSnapSignature({
          clientId: config.clientId,
          requestId,
          timestamp,
          target,
          clientSecret: config.clientSecret,
        }),
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const result = (await response.json()) as CheckoutStatusResponse;
    if (!response.ok) {
      throw new Error(
        `DOKU check status gagal (${response.status}): ${(result.error_messages ?? ["tanpa pesan"]).join(", ")}`,
      );
    }

    return {
      orderId: result.order?.invoice_number ?? orderId,
      referenceNo: result.transaction?.original_request_id ?? null,
      transactionStatus: mapDokuCheckoutStatus(result.transaction?.status),
      transactionStatusDesc: result.transaction?.status ?? null,
      paidTime: result.transaction?.date ?? null,
      amountValue: result.order?.amount != null ? String(result.order.amount) : null,
      raw: result,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Verifikasi signature notifikasi non-SNAP (header Client-Id/Request-Id/...). */
export function verifyDokuNonSnapNotification(input: {
  clientId: string | null;
  requestId: string | null;
  timestamp: string | null;
  signature: string | null;
  path: string;
  rawBody: string;
}): boolean {
  const config = getDokuCheckoutConfig();
  if (!config) return false;
  if (!input.clientId || !input.requestId || !input.timestamp || !input.signature) {
    return false;
  }
  if (input.clientId !== config.clientId) return false;

  const expected = buildNonSnapSignature({
    clientId: input.clientId,
    requestId: input.requestId,
    timestamp: input.timestamp,
    target: input.path,
    rawBody: input.rawBody,
    clientSecret: config.clientSecret,
  });

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
