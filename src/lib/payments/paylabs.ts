import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as rsaSign,
  verify as rsaVerify,
} from "node:crypto";
import {
  getPaylabsEnvironment,
  type PaymentProviderId,
} from "@/lib/payment-settings";
import type { CreatePaymentInput, PaymentSession } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

function booleanEnv(name: string) {
  return env(name).toLowerCase() === "true";
}

export type PaylabsConfig = {
  rootUrl: string;
  merchantId: string;
  partnerId: string;
  privateKey: string;
  publicKey: string;
  environment: "sandbox" | "production";
  defaultVaPaymentType: string;
  notifyUrl: string | null;
};

export function getPaylabsConfig(): PaylabsConfig | null {
  const merchantId = env("PAYLABS_MERCHANT_ID");
  const partnerId = env("PAYLABS_PARTNER_ID") || merchantId;
  const rootUrl = env("PAYLABS_ROOT_URL").replace(/\/+$/, "");
  const environment = getPaylabsEnvironment();
  let privateKey = env("PAYLABS_PRIVATE_KEY").replace(/\\n/g, "\n");
  let publicKey = env("PAYLABS_PUBLIC_KEY").replace(/\\n/g, "\n");

  if (!merchantId || !partnerId || !rootUrl || !privateKey) return null;

  // Lengkapi armor bila yang ditempel hanya isi base64 (tanpa header PEM).
  if (!privateKey.includes("BEGIN")) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey.replace(/\s/g, "")}\n-----END PRIVATE KEY-----`;
  }
  if (publicKey && !publicKey.includes("BEGIN")) {
    publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKey.replace(/\s/g, "")}\n-----END PUBLIC KEY-----`;
  }

  // Tolak kalau yang diisi justru public key di kolom private key.
  if (
    privateKey.includes("BEGIN PUBLIC KEY") ||
    privateKey.replace(/\s/g, "").startsWith("MIIBIj")
  ) {
    console.error(
      "PAYLABS_PRIVATE_KEY berisi PUBLIC key — integrasi Paylabs dinonaktifkan.",
    );
    return null;
  }

  try {
    createPrivateKey(privateKey);
  } catch {
    console.error("PAYLABS_PRIVATE_KEY tidak valid.");
    return null;
  }

  if (publicKey) {
    try {
      createPublicKey(publicKey);
    } catch {
      console.error("PAYLABS_PUBLIC_KEY tidak valid.");
      return null;
    }
  }

  // Di production, webhook Paylabs wajib diverifikasi dengan public key.
  // Tanpa ini, notifikasi bisa dipalsukan dan status order bisa dimanipulasi.
  if (environment === "production" && !publicKey) {
    console.error(
      "PAYLABS_PUBLIC_KEY wajib diisi di production untuk verifikasi webhook Paylabs.",
    );
    return null;
  }

  return {
    rootUrl,
    merchantId,
    partnerId,
    privateKey,
    publicKey,
    environment,
    defaultVaPaymentType:
      env("PAYLABS_DEFAULT_VA_PAYMENT_TYPE") || "SinarmasVA",
    notifyUrl: env("PAYLABS_NOTIFY_URL") || null,
  };
}

export function isPaylabsConfigured() {
  return getPaylabsConfig() !== null;
}

// ---------------------------------------------------------------------------
// Primitive helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function paylabsTimestamp(date = new Date()) {
  const formatted = date
    .toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" })
    .replace(" ", "T");
  return `${formatted}.000+07:00`;
}

export function minifyJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => minifyJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}:${minifyJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function sha256HexLower(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex").toLowerCase();
}

export function createPaylabsSignature(input: {
  method: string;
  path: string;
  body: unknown;
  timestamp: string;
  privateKey: string;
}) {
  const bodyString = minifyJson(input.body);
  const stringToSign = [
    input.method.toUpperCase(),
    input.path,
    sha256HexLower(bodyString),
    input.timestamp,
  ].join(":");
  return rsaSign(
    "RSA-SHA256",
    Buffer.from(stringToSign, "utf8"),
    input.privateKey,
  ).toString("base64");
}

export function verifyPaylabsSignature(input: {
  method: string;
  path: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  publicKey: string;
}) {
  if (!input.timestamp || !input.signature || !input.publicKey) return false;
  let minified: string;
  try {
    minified = minifyJson(JSON.parse(input.body));
  } catch {
    minified = input.body.trim();
  }
  const stringToSign = [
    input.method.toUpperCase(),
    input.path,
    sha256HexLower(minified),
    input.timestamp,
  ].join(":");
  try {
    return rsaVerify(
      "RSA-SHA256",
      Buffer.from(stringToSign, "utf8"),
      input.publicKey,
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function getPaylabsNotificationPath(fallback: string) {
  const url = env("PAYLABS_NOTIFY_URL");
  if (!url) return fallback;
  try {
    const pathname = new URL(url).pathname;
    return pathname || fallback;
  } catch {
    return url.startsWith("/") ? url : fallback;
  }
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

async function paylabsFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ result: T; requestId: string; timestamp: string }> {
  const config = getPaylabsConfig();
  if (!config)
    throw new Error(
      "Paylabs belum dikonfigurasi (PAYLABS_MERCHANT_ID / PAYLABS_PRIVATE_KEY / PAYLABS_ROOT_URL).",
    );

  const requestId = randomUUID();
  const timestamp = paylabsTimestamp();
  const payload = {
    ...body,
    requestId,
    merchantId: body.merchantId ?? config.merchantId,
  };

  const bodyString = minifyJson(payload);
  const signature = createPaylabsSignature({
    method: "POST",
    path,
    body: payload,
    timestamp,
    privateKey: config.privateKey,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${config.rootUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PARTNER-ID": config.partnerId,
        "X-REQUEST-ID": requestId,
      },
      body: bodyString,
      cache: "no-store",
      signal: controller.signal,
    });

    const result = (await response.json()) as T & {
      errCode?: string;
      errCodeDes?: string;
    };
    if (!response.ok || (result.errCode && result.errCode !== "0")) {
      throw new Error(
        `Paylabs ${path} gagal (${result.errCode ?? response.status}): ${result.errCodeDes ?? "tanpa pesan"}`,
      );
    }
    return { result, requestId, timestamp };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

function amountString(amount: number) {
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function normalizePaylabsStatus(status: string | undefined) {
  switch (status) {
    case "02":
      return "settlement";
    case "09":
      return "failure";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// QRIS
// ---------------------------------------------------------------------------

export interface PaylabsQrisCreateResult {
  qrCode: string | null;
  qrisUrl: string | null;
  nmid: string | null;
  tid: string | null;
  platformTradeNo: string | null;
  expiredTime: string | null;
  raw: unknown;
}

export async function createPaylabsQrisPayment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const config = getPaylabsConfig();
  if (!config) throw new Error("Paylabs belum dikonfigurasi.");

  const { result, requestId } = await paylabsFetch<
    PaylabsQrisCreateResult & Record<string, unknown>
  >("/payment/v2.3/qris/create", {
    paymentType: "QRIS",
    amount: amountString(input.grossAmount),
    merchantTradeNo: input.orderId,
    productName: input.itemName,
    notifyUrl: config.notifyUrl ?? undefined,
  });

  const r = result as Record<string, unknown>;
  if (!r.qrCode && !r.qrisUrl) {
    throw new Error("Paylabs QRIS tidak mengembalikan qrCode/qrisUrl.");
  }

  return {
    provider: "paylabs" as PaymentProviderId,
    payload: {
      kind: "qris",
      qrContent: (r.qrCode as string | undefined) ?? undefined,
      redirectUrl: (r.qrisUrl as string | undefined) ?? undefined,
      expiresAt: (r.expiredTime as string | undefined) ?? null,
      raw: {
        requestId,
        platformTradeNo: (r.platformTradeNo as string | undefined) ?? null,
        referenceNo: (r.platformTradeNo as string | undefined) ?? null,
        nmid: (r.nmid as string | undefined) ?? null,
        tid: (r.tid as string | undefined) ?? null,
      },
    },
  };
}

export interface PaylabsQrisStatusResult {
  orderId: string;
  platformTradeNo: string | null;
  transactionStatus: "settlement" | "pending" | "failure";
  transactionStatusDesc: string | null;
  paidTime: string | null;
  amountValue: string | null;
  status: string | null;
  raw: unknown;
}

export async function fetchPaylabsQrisStatus(input: {
  orderId: string;
  platformTradeNo?: string | null;
}): Promise<PaylabsQrisStatusResult> {
  const config = getPaylabsConfig();
  if (!config) throw new Error("Paylabs belum dikonfigurasi.");

  const { result } = await paylabsFetch<Record<string, unknown>>(
    "/payment/v2.3/qris/query",
    {
      merchantTradeNo: input.orderId,
      paymentType: "QRIS",
    },
  );

  const r = result as Record<string, unknown>;
  return {
    orderId: (r.merchantTradeNo as string | undefined) ?? input.orderId,
    platformTradeNo:
      (r.platformTradeNo as string | undefined) ??
      input.platformTradeNo ??
      null,
    transactionStatus: normalizePaylabsStatus(r.status as string | undefined),
    transactionStatusDesc: (r.status as string | undefined) ?? null,
    paidTime: (r.successTime as string | undefined) ?? null,
    amountValue: r.amount != null ? String(r.amount) : null,
    status: (r.status as string | undefined) ?? null,
    raw: result,
  };
}

// ---------------------------------------------------------------------------
// VA
// ---------------------------------------------------------------------------

export async function createPaylabsVaPayment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const config = getPaylabsConfig();
  if (!config) throw new Error("Paylabs belum dikonfigurasi.");

  const paymentType = config.defaultVaPaymentType;
  const { result, requestId } = await paylabsFetch<Record<string, unknown>>(
    "/payment/v2.3/va/create",
    {
      paymentType,
      amount: amountString(input.grossAmount),
      merchantTradeNo: input.orderId,
      productName: input.itemName,
      payer: input.customerEmail ?? "Customer",
      notifyUrl: config.notifyUrl ?? undefined,
    },
  );

  const r = result;
  return {
    provider: "paylabs" as PaymentProviderId,
    payload: {
      kind: "va",
      vaNumber: (r.vaCode as string | undefined) ?? undefined,
      bankCode: paymentType,
      expiresAt: r.expiredTime != null ? String(r.expiredTime) : null,
      raw: {
        requestId,
        platformTradeNo: (r.platformTradeNo as string | undefined) ?? null,
        referenceNo: (r.platformTradeNo as string | undefined) ?? null,
        paymentType,
        createTime: r.createTime,
      },
    },
  };
}

export async function fetchPaylabsVaStatus(input: {
  orderId: string;
  platformTradeNo?: string | null;
}) {
  const { result } = await paylabsFetch<Record<string, unknown>>(
    "/payment/v2.3/va/query",
    {
      merchantTradeNo: input.orderId,
      paymentType: resultPaymentTypeFallback(),
    },
  );
  const r = result;
  return {
    orderId: (r.merchantTradeNo as string | undefined) ?? input.orderId,
    platformTradeNo:
      (r.platformTradeNo as string | undefined) ??
      input.platformTradeNo ??
      null,
    transactionStatus: normalizePaylabsStatus(r.status as string | undefined),
    transactionStatusDesc: (r.status as string | undefined) ?? null,
    paidTime:
      (r.successTime as string | undefined) ??
      (r.createTime as string | undefined) ??
      null,
    amountValue: r.amount != null ? String(r.amount) : null,
    status: (r.status as string | undefined) ?? null,
    raw: result,
  };
}

function resultPaymentTypeFallback() {
  return getPaylabsConfig()?.defaultVaPaymentType ?? "SinarmasVA";
}

// ---------------------------------------------------------------------------
// HTML5 (hosted fallback)
// ---------------------------------------------------------------------------

export async function createPaylabsHtml5Payment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const config = getPaylabsConfig();
  if (!config) throw new Error("Paylabs belum dikonfigurasi.");

  const { result, requestId } = await paylabsFetch<Record<string, unknown>>(
    "/payment/v2.3/h5/createLink",
    {
      amount: amountString(input.grossAmount),
      merchantTradeNo: input.orderId,
      phoneNumber: input.customerPhone || "00000000",
      productName: input.itemName,
      redirectUrl: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")}/order/${input.orderId}`
        : undefined,
      notifyUrl: config.notifyUrl ?? undefined,
      payer: input.customerEmail ?? undefined,
    },
  );

  const url = (result as Record<string, unknown>).url as string | undefined;
  if (!url) throw new Error("Paylabs HTML5 tidak mengembalikan url.");

  return {
    provider: "paylabs" as PaymentProviderId,
    payload: {
      kind: "redirect",
      redirectUrl: url,
      raw: { requestId, ...(result as Record<string, unknown>) },
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function createPaylabsPayment(
  input: CreatePaymentInput,
): Promise<PaymentSession> {
  const method = input.paymentMethodId.toLowerCase();
  if (method.includes("qris")) return createPaylabsQrisPayment(input);
  if (method.includes("va") || method.includes("virtual"))
    return createPaylabsVaPayment(input);
  return createPaylabsHtml5Payment(input);
}

// Signature wrapper exported names for webhook compatibility
export const createPaylabsSignatureForResponse = createPaylabsSignature;
