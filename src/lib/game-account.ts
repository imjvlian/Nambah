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
  // Bila terisi, field dirender sebagai <select> berisi nilai-nilai ini
  // (bukan input teks bebas) dan validasi menolak nilai di luar daftar.
  options?: string[];
};

export type GameAccountSchema = {
  kind:
    | "mobile-legends"
    | "magic-chess"
    | "genshin"
    | "roblox"
    | "valorant"
    | "numeric-player"
    | "generic";
  user: AccountField;
  server?: AccountField;
  checker: "mobile-legends" | "universal" | null;
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

// Riot ID Valorant berformat `Nama#Tag` — `#` wajib diizinkan, kalau tidak
// customer tidak akan pernah lolos validasi untuk game ini.
const VALORANT_USER: AccountField = {
  label: "Riot ID",
  placeholder: "Contoh: Joko#1234",
  inputMode: "text",
  maxLength: 22,
  sanitize: "identifier",
  pattern: /^[A-Za-z0-9 ]{3,16}#[A-Za-z0-9]{3,5}$/,
  invalidMessage: "Riot ID harus berformat Nama#Tag (contoh: Joko#1234).",
};

// Server Genshin hanya punya 4 nilai sah dari publisher. Dibuat dropdown
// supaya typo seperti `asia`/`ASIA` tidak terkirim ke supplier.
const GENSHIN_SERVER_OPTIONS = ["Asia", "America", "Europe", "TW/HK/MO"];

const GENSHIN_SERVER: AccountField = {
  label: "Server / Region",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 8,
  sanitize: "identifier",
  pattern: /^(Asia|America|Europe|TW\/HK\/MO)$/,
  invalidMessage: "Pilih salah satu server: Asia, America, Europe, atau TW/HK/MO.",
  options: GENSHIN_SERVER_OPTIONS,
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
      checker: "universal",
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
      ...(requiresServer ? { server: GENSHIN_SERVER } : {}),
      checker: "universal",
      helper: requiresServer
        ? "Masukkan UID dan pilih server/region akun Genshin."
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
      checker: "universal",
      helper: "Pastikan username atau User ID Roblox tepat sebelum pembayaran.",
    };
  }

  if (/valorant|\bvalo\b/.test(identity)) {
    return {
      kind: "valorant",
      user: VALORANT_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: "universal",
      helper: "Masukkan Riot ID lengkap dengan tag, contoh: Joko#1234.",
    };
  }

  if (/free fire|\bff\b|pubg|honor of kings|\bhok\b/.test(identity)) {
    return {
      kind: "numeric-player",
      user: GENERIC_NUMERIC_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: "universal",
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

/**
 * Buang karakter yang tidak valid dari sebuah field akun.
 *
 * Sengaja TIDAK memotong panjang. Pemotongan hanya aman untuk membatasi ketikan
 * di form (`sanitizeAccountField`), karena user masih melihat dan memperbaiki
 * input-nya sendiri. Di jalur validasi server memotong berarti mengubah ID
 * tujuan menjadi ID yang berbeda tanpa ada yang tahu — lalu ID salah itu yang
 * dikirim ke supplier dan customer membayar top-up untuk akun yang bukan miliknya.
 */
export function stripAccountFieldCharacters(value: string, field: AccountField) {
  return field.sanitize === "digits"
    ? value.replace(/\D/g, "")
    : field.sanitize === "username"
      ? value.replace(/[^A-Za-z0-9_]/g, "")
      : value.replace(/[^A-Za-z0-9@._+\-#/ ]/g, "");
}

/**
 * Sanitasi untuk input form: buang karakter invalid DAN potong ke `maxLength`.
 *
 * Dipakai `onChange` di form, jadi nilai yang tampil selalu sudah valid dan
 * user tidak bisa mengetik melewati batas. Validasi server TIDAK boleh memakai
 * fungsi ini — pakai `stripAccountFieldCharacters` + `pattern` supaya input
 * kelewat panjang ditolak dengan pesan, bukan diam-diam dipotong.
 */
export function sanitizeAccountField(value: string, field: AccountField) {
  return stripAccountFieldCharacters(value, field).slice(0, field.maxLength);
}

export function validateGameAccountTarget(
  game: AccountGameDescriptor,
  rawUserId: string,
  rawServerId?: string,
): AccountValidationResult {
  const schema = getGameAccountSchema(game);

  // Dipakai `stripAccountFieldCharacters`, bukan `sanitizeAccountField`: kalau
  // input dipotong di sini, pattern tetap lolos dan ID hasil potong dikirim ke
  // supplier. Kuantifier panjang di setiap `pattern` (mis. `{3,64}`) sudah
  // menegakkan batas maksimum, jadi input kepanjangan ditolak di bawah dengan
  // `invalidMessage` yang sudah ada.
  const userId = stripAccountFieldCharacters(rawUserId, schema.user).trim();

  if (!userId) {
    return { ok: false, error: `${schema.user.label} wajib diisi.` };
  }
  if (!schema.user.pattern.test(userId)) {
    return { ok: false, error: schema.user.invalidMessage };
  }

  if (!schema.server) return { ok: true, userId };

  const serverId = stripAccountFieldCharacters(
    rawServerId ?? "",
    schema.server,
  ).trim();
  if (!serverId) {
    return { ok: false, error: `${schema.server.label} wajib diisi.` };
  }
  if (!schema.server.pattern.test(serverId)) {
    return { ok: false, error: schema.server.invalidMessage };
  }

  return { ok: true, userId, serverId };
}
