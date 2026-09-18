export type GuestReceiptContactResult =
  | {
      ok: true;
      email: string;
      whatsapp: string;
    }
  | {
      ok: false;
      error: string;
    };

export function normalizeReceiptEmail(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, 254)
    : "";
}

export function isValidReceiptEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeReceiptWhatsapp(value: unknown) {
  if (typeof value !== "string") return "";

  let digits = value.trim().replace(/[^0-9+]/g, "");
  if (!digits) return "";

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;

  return digits ? `+${digits}` : "";
}

export function isValidIndonesianWhatsapp(value: string) {
  const digits = value.replace(/^\+/, "");
  return /^628\d{7,11}$/.test(digits);
}

export function validateGuestReceiptContact(
  emailValue: unknown,
  whatsappValue: unknown,
): GuestReceiptContactResult {
  const email = normalizeReceiptEmail(emailValue);
  if (!email) {
    return { ok: false, error: "Email receipt wajib diisi." };
  }
  if (!isValidReceiptEmail(email)) {
    return { ok: false, error: "Format email receipt tidak valid." };
  }

  const whatsapp = normalizeReceiptWhatsapp(whatsappValue);
  if (!whatsapp) {
    return { ok: false, error: "Nomor WhatsApp wajib diisi." };
  }
  if (!isValidIndonesianWhatsapp(whatsapp)) {
    return {
      ok: false,
      error: "Nomor WhatsApp tidak valid. Gunakan nomor Indonesia aktif, contoh 081234567890.",
    };
  }

  return { ok: true, email, whatsapp };
}
