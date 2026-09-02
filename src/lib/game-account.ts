export type AccountGameDescriptor = {
  id: string;
  name: string;
  shortName?: string;
  requiresServer?: boolean;
};

export type AccountField = {
  label: string;
  placeholder: string;
  inputMode: "numeric" | "text";
  maxLength: number;
  sanitize: "digits" | "username" | "identifier";
  pattern: RegExp;
  invalidMessage: string;
};

export type GameAccountSchema = {
  kind: "mobile-legends" | "magic-chess" | "genshin" | "roblox" | "numeric-player" | "generic";
  user: AccountField;
  server?: AccountField;
  checker: "mobile-legends" | null;
  helper: string;
};

export type AccountValidationResult =
  | { ok: true; userId: string; serverId?: string }
  | { ok: false; error: string };

function normalizeIdentity(game: AccountGameDescriptor) {
  return `${game.id} ${game.name} ${game.shortName ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ML_USER: AccountField = {
  label: "User ID",
  placeholder: "Contoh: 123456789",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{5,12}$/,
  invalidMessage: "User ID Mobile Legends harus 5–12 digit.",
};

const ML_SERVER: AccountField = {
  label: "Zone ID",
  placeholder: "Contoh: 1234",
  inputMode: "numeric",
  maxLength: 5,
  sanitize: "digits",
  pattern: /^\d{3,5}$/,
  invalidMessage: "Zone ID Mobile Legends harus 3–5 digit.",
};

const GENERIC_NUMERIC_USER: AccountField = {
  label: "Player ID",
  placeholder: "Masukkan Player ID",
  inputMode: "numeric",
  maxLength: 20,
  sanitize: "digits",
  pattern: /^\d{4,20}$/,
  invalidMessage: "Player ID harus 4–20 digit.",
};

const GENERIC_NUMERIC_SERVER: AccountField = {
  label: "Server / Zone ID",
  placeholder: "Masukkan Server / Zone ID",
  inputMode: "numeric",
  maxLength: 10,
  sanitize: "digits",
  pattern: /^\d{1,10}$/,
  invalidMessage: "Server / Zone ID harus 1–10 digit.",
};

const GENERIC_USER: AccountField = {
  label: "User ID / Tujuan",
  placeholder: "Masukkan User ID atau tujuan",
  inputMode: "text",
  maxLength: 64,
  sanitize: "identifier",
  pattern: /^[A-Za-z0-9@._+\- ]{3,64}$/,
  invalidMessage: "User ID / tujuan harus 3–64 karakter yang valid.",
};

const GENERIC_SERVER: AccountField = {
  label: "Server / Region",
  placeholder: "Masukkan Server / Region",
  inputMode: "text",
  maxLength: 32,
  sanitize: "identifier",
  pattern: /^[A-Za-z0-9._+\- ]{1,32}$/,
  invalidMessage: "Server / Region tidak valid.",
};

export function getGameAccountSchema(game: AccountGameDescriptor): GameAccountSchema {
  const identity = normalizeIdentity(game);
  const requiresServer = Boolean(game.requiresServer);

  if (/mobile legends|\bmlbb\b/.test(identity)) {
    return {
      kind: "mobile-legends",
      user: ML_USER,
      server: ML_SERVER,
      checker: "mobile-legends",
      helper: "Masukkan User ID dan Zone ID. Nickname akan dicek otomatis bila layanan checker tersedia.",
    };
  }

  if (/magic chess|\bmcgg\b/.test(identity)) {
    return {
      kind: "magic-chess",
      user: {
        ...GENERIC_NUMERIC_USER,
        label: "User ID",
        placeholder: "Masukkan User ID Magic Chess",
      },
      ...(requiresServer
        ? {
            server: {
              ...GENERIC_NUMERIC_SERVER,
              label: "Zone ID",
              placeholder: "Masukkan Zone ID",
            },
          }
        : {}),
      checker: null,
      helper: requiresServer
        ? "Pastikan User ID dan Zone ID sesuai akun Magic Chess: Go Go."
        : "Pastikan User ID sesuai akun Magic Chess: Go Go.",
    };
  }

  if (/genshin/.test(identity)) {
    return {
      kind: "genshin",
      user: {
        label: "UID",
        placeholder: "Masukkan UID Genshin",
        inputMode: "numeric",
        maxLength: 10,
        sanitize: "digits",
        pattern: /^\d{9,10}$/,
        invalidMessage: "UID Genshin harus 9–10 digit.",
      },
      ...(requiresServer
        ? {
            server: {
              ...GENERIC_SERVER,
              label: "Server / Region",
              placeholder: "Contoh: Asia",
            },
          }
        : {}),
      checker: null,
      helper: requiresServer
        ? "Masukkan UID dan nama server/region akun Genshin."
        : "Masukkan UID akun Genshin.",
    };
  }

  if (/roblox|\brobux\b/.test(identity)) {
    return {
      kind: "roblox",
      user: {
        label: "Username / User ID",
        placeholder: "Masukkan username atau User ID Roblox",
        inputMode: "text",
        maxLength: 32,
        sanitize: "username",
        pattern: /^[A-Za-z0-9_]{3,32}$/,
        invalidMessage: "Username / User ID Roblox harus 3–32 karakter (huruf, angka, atau _).",
      },
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: null,
      helper: "Pastikan username atau User ID Roblox tepat sebelum pembayaran.",
    };
  }

  if (/free fire|\bff\b|pubg|honor of kings|\bhok\b/.test(identity)) {
    return {
      kind: "numeric-player",
      user: GENERIC_NUMERIC_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: null,
      helper: requiresServer
        ? "Masukkan Player ID dan Server / Zone ID sesuai akun game."
        : "Masukkan Player ID sesuai akun game.",
    };
  }

  return {
    kind: "generic",
    user: GENERIC_USER,
    ...(requiresServer ? { server: GENERIC_SERVER } : {}),
    checker: null,
    helper: requiresServer
      ? "Masukkan ID tujuan dan Server / Region sesuai informasi akun."
      : "Masukkan ID atau tujuan sesuai produk yang dipilih.",
  };
}

export function sanitizeAccountField(value: string, field: AccountField) {
  const sanitized =
    field.sanitize === "digits"
      ? value.replace(/\D/g, "")
      : field.sanitize === "username"
        ? value.replace(/[^A-Za-z0-9_]/g, "")
        : value.replace(/[^A-Za-z0-9@._+\- ]/g, "");

  return sanitized.slice(0, field.maxLength);
}

export function validateGameAccountTarget(
  game: AccountGameDescriptor,
  rawUserId: string,
  rawServerId?: string,
): AccountValidationResult {
  const schema = getGameAccountSchema(game);
  const userId = sanitizeAccountField(rawUserId, schema.user).trim();

  if (!userId) {
    return { ok: false, error: `${schema.user.label} wajib diisi.` };
  }
  if (!schema.user.pattern.test(userId)) {
    return { ok: false, error: schema.user.invalidMessage };
  }

  if (!schema.server) return { ok: true, userId };

  const serverId = sanitizeAccountField(rawServerId ?? "", schema.server).trim();
  if (!serverId) {
    return { ok: false, error: `${schema.server.label} wajib diisi.` };
  }
  if (!schema.server.pattern.test(serverId)) {
    return { ok: false, error: schema.server.invalidMessage };
  }

  return { ok: true, userId, serverId };
}
