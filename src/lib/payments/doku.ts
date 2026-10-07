import { createHash, createHmac, sign as rsaSign, timingSafeEqual } from "node:crypto";
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
  return {
    baseUrl: BASE_URLS[environment],
    clientId,
    clientSecret,
    privateKey,
    merchantId,
    terminalId,
    postalCode: env("DOKU_POSTAL_CODE") || "12190",
    environment,
  };
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
