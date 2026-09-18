const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_TIMEOUT_MS = 15_000;

export type BrevoTransactionalEmail = {
  to: string;
  subject: string;
  htmlContent: string;
  tags?: string[];
};

export type BrevoSendResult = {
  messageId: string;
};

function configured(name: string) {
  return process.env[name]?.trim() ?? "";
}

function enabled(name: string) {
  return ["true", "1", "yes", "on"].includes(configured(name).toLowerCase());
}

export function isBrevoReceiptEnabled() {
  return enabled("BREVO_RECEIPT_ENABLED");
}

export function isBrevoConfigured() {
  return Boolean(
    configured("BREVO_API_KEY") &&
      configured("BREVO_SENDER_EMAIL"),
  );
}

function requireBrevoConfig() {
  const apiKey = configured("BREVO_API_KEY");
  const senderEmail = configured("BREVO_SENDER_EMAIL");
  const senderName = configured("BREVO_SENDER_NAME") || "Nambah";

  if (!apiKey || !senderEmail) {
    throw new Error(
      "Brevo belum dikonfigurasi. Isi BREVO_API_KEY dan BREVO_SENDER_EMAIL.",
    );
  }

  return { apiKey, senderEmail, senderName };
}

export async function sendBrevoTransactionalEmail(
  input: BrevoTransactionalEmail,
): Promise<BrevoSendResult> {
  const { apiKey, senderEmail, senderName } = requireBrevoConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);

  try {
    const response = await fetch(BREVO_EMAIL_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.htmlContent,
        ...(input.tags?.length ? { tags: input.tags } : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: { messageId?: string; message?: string; code?: string } = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      // Keep raw response below for diagnostics.
    }

    if (!response.ok) {
      const detail =
        payload.message ||
        payload.code ||
        raw ||
        `HTTP ${response.status}`;
      throw new Error(
        `Brevo email failed (${response.status}): ${String(detail).slice(0, 500)}`,
      );
    }

    if (!payload.messageId) {
      throw new Error("Brevo tidak mengembalikan messageId.");
    }

    return { messageId: payload.messageId };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Brevo timeout saat mengirim receipt.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
