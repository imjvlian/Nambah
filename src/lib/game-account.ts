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
    | "wuthering-waves"
    | "phone"
    | "numeric-bill"
    | "numeric-player"
    | "alphanumeric-player"
    | "contact"
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

// Server Wuthering Waves: 5 region resmi Kuro Games. Dropdown supaya tidak
// ada typo yang terkirim ke supplier.
const WUTHERING_SERVER_OPTIONS = ["America", "Europe", "Asia", "SEA", "HMT"];

const WUTHERING_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 7,
  sanitize: "identifier",
  pattern: /^(America|Europe|Asia|SEA|HMT)$/,
  invalidMessage: "Pilih salah satu server: America, Europe, Asia, SEA, atau HMT.",
  options: WUTHERING_SERVER_OPTIONS,
};

// Pulsa & e-money: targetnya nomor HP Indonesia, bukan teks bebas.
const PHONE_USER: AccountField = {
  label: "Nomor HP",
  placeholder: "Contoh: 081234567890",
  inputMode: "numeric",
  maxLength: 14,
  sanitize: "digits",
  pattern: /^08\d{8,12}$/,
  invalidMessage: "Nomor HP harus diawali 08 dan terdiri dari 10–14 digit.",
};

// Tagihan (PLN, gas, TV berbayar): targetnya nomor pelanggan numerik.
const BILL_USER: AccountField = {
  ...GENERIC_NUMERIC_USER,
  label: "Nomor Pelanggan / ID",
  placeholder: "Masukkan nomor pelanggan / ID",
  invalidMessage: "Nomor pelanggan / ID harus 4–20 digit.",
};

// Point Blank: targetnya login ID Zepetto yang alfanumerik (bukan murni angka),
// jadi skema numeric-player akan menolak ID yang sah.
const POINT_BLANK_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID Point Blank",
  inputMode: "text",
  maxLength: 24,
  sanitize: "username",
  pattern: /^[A-Za-z0-9_]{4,24}$/,
  invalidMessage: "User ID Point Blank harus 4–24 karakter (huruf, angka, atau _).",
};

// SKU voucher kode redeem (Steam Wallet Code, Google Play, PSN, Garena Shells,
// eFootball): produk dikirim berupa SN kode, jadi customer_no supplier cukup
// berisi kontak referensi — email atau nomor HP aktif.
const CONTACT_USER: AccountField = {
  label: "Email / No. HP",
  placeholder: "Contoh: nama@email.com atau 081234567890",
  inputMode: "text",
  maxLength: 64,
  sanitize: "identifier",
  pattern: /^(08\d{8,12}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})$/,
  invalidMessage: "Masukkan email yang valid atau nomor HP diawali 08 (10–14 digit).",
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

  // Valorant, Wild Rift, dan Legends of Runeterra sama-sama game Riot —
  // fulfillment Digiflazz untuk ketiganya memakai Riot ID (Nama#Tag).
  if (/valorant|\bvalo\b|wild rift|runeterra/.test(identity)) {
    return {
      kind: "valorant",
      user: VALORANT_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: "universal",
      helper: "Masukkan Riot ID lengkap dengan tag, contoh: Joko#1234.",
    };
  }

  if (/wuthering|\bwuwa\b/.test(identity)) {
    return {
      kind: "wuthering-waves",
      user: {
        ...GENERIC_NUMERIC_USER,
        label: "UID",
        placeholder: "Masukkan UID Wuthering Waves",
        pattern: /^\d{8,12}$/,
        invalidMessage: "UID Wuthering Waves harus 8–12 digit.",
      },
      ...(requiresServer ? { server: WUTHERING_SERVER } : {}),
      checker: "universal",
      helper: requiresServer
        ? "Masukkan UID dan pilih server akun Wuthering Waves."
        : "Masukkan UID akun Wuthering Waves.",
    };
  }

  // Point Blank harus dicek SEBELUM numeric-player: login ID-nya alfanumerik.
  if (/point blank/.test(identity)) {
    return {
      kind: "alphanumeric-player",
      user: POINT_BLANK_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: "universal",
      helper: "Masukkan User ID Point Blank (login ID) dengan benar.",
    };
  }

  if (
    /free fire|\bff\b|pubg|honor of kings|\bhok\b|arena of valor|\baov\b|delta force|fc mobile|marvel rivals|aniimo/.test(
      identity,
    )
  ) {
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

  // SKU voucher kode redeem: SN kode adalah produknya, customer_no cukup
  // kontak referensi. Diletakkan setelah cabang game spesifik supaya game
  // seperti Free Fire (publisher Garena) tidak terseret ke sini.
  if (/steam|google play|playstation|\bgarena\b|efootball/.test(identity)) {
    return {
      kind: "contact",
      user: CONTACT_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: null,
      helper:
        "Kode voucher dikirim ke halaman status order. Masukkan email atau nomor HP aktif sebagai referensi pengiriman.",
    };
  }

  // Pulsa operator & dompet digital: target selalu nomor HP.
  if (
    /telkomsel|indosat|\bxl\b|axis|\btri\b|smartfren|by u|\bdana\b|go pay|gopay|\bovo\b|shopee pay|link aja/.test(
      identity,
    )
  ) {
    return {
      kind: "phone",
      user: PHONE_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: null,
      helper: "Masukkan nomor HP tujuan yang aktif dan benar.",
    };
  }

  // Tagihan: PLN, gas, TV berbayar — target nomor pelanggan numerik.
  if (/pln|pertamina|k vision|kvision/.test(identity)) {
    return {
      kind: "numeric-bill",
      user: BILL_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: null,
      helper: "Masukkan nomor pelanggan / ID sesuai tagihan.",
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
