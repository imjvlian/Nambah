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
    | "zenless-zone-zero"
    | "honkai-star-rail"
    | "ragnarok-m"
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
  invalidMessage: "User ID Point Blank harus 4-24 karakter (huruf, angka, atau _).",
};

// Dragon Nest M Classic & NBA Infinite: deskripsi Digiflazz keduanya
// `[UID][|Server]` / "Masukkan ID dan Server", jadi ID dan server wajib.
const DN_NBA_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID",
  inputMode: "numeric",
  maxLength: 20,
  sanitize: "digits",
  pattern: /^\d{4,20}$/,
  invalidMessage: "User ID harus 4-20 digit.",
};

// Dragon Nest M: Classic. Deskripsi Seller di panel Digiflazz menjawabnya
// langsung:
//   "Note : User ID|Server  Contoh : 400628|030003"
// Server-nya ANGKA 6 digit yang dimulai dengan nol — bukan nama channel
// seperti "Argenta" atau "Newark" yang terlihat di hasil riset.
//
// Nol di depan itu yang menentukan bentuk kolomnya: nomor channel Dragon Nest
// banyak dan terus bertambah, jadi tidak mungkin dijadikan dropdown. Yang wajib
// dijaga adalah kolom ini bisa menyimpan `030003` apa adanya — `sanitize:
// "digits"` mempertahankan nol di depan selama input-nya bukan `type="number"`.
//
// Teks bebas sengaja tidak dipakai: kalau pelanggan mengetik nama channel,
// validasi kita lolos lalu order-nya ditolak supplier setelah dibayar.
const DRAGON_NEST_SERVER: AccountField = {
  label: "Server",
  placeholder: "Contoh: 030003",
  inputMode: "numeric",
  maxLength: 10,
  sanitize: "digits",
  pattern: /^\d{3,10}$/,
  invalidMessage: "Server Dragon Nest M berupa angka, contoh: 030003.",
};

// NBA Infinite: filter server di halaman top-up resmi memuat "Asia, Europe,
// NA, LATAM, Oceania". Ini wilayah geografis, bukan shard per akun, jadi
// daftarnya stabil dan aman dijadikan dropdown.
const NBA_INFINITE_SERVER_OPTIONS = ["Asia", "Europe", "NA", "LATAM", "Oceania"];

const NBA_INFINITE_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 16,
  sanitize: "identifier",
  pattern: /^(Asia|Europe|NA|LATAM|Oceania)$/,
  invalidMessage:
    "Pilih salah satu server: Asia, Europe, NA, LATAM, atau Oceania.",
  options: NBA_INFINITE_SERVER_OPTIONS,
};

// State of Survival & Where Winds Meet: deskripsi Digiflazz "Masukkan User
// ID." dan "Masukkan ID Akun" — keduanya tanpa server.
const STATE_OF_SURVIVAL_USER: AccountField = {
  ...GENERIC_NUMERIC_USER,
  label: "User ID",
  placeholder: "Masukkan User ID",
};

const WHERE_WINDS_MEET_USER: AccountField = {
  ...GENERIC_NUMERIC_USER,
  label: "ID Akun",
  placeholder: "Masukkan ID Akun",
  pattern: /^\d{6,16}$/,
  invalidMessage: "ID Akun harus 6-16 digit.",
};

// Call of Duty Mobile: deskripsi Digiflazz "Masukkan PlayerID".
const COD_MOBILE_USER: AccountField = {
  ...GENERIC_NUMERIC_USER,
  label: "Player ID",
  placeholder: "Masukkan Player ID Call of Duty Mobile",
};

// Zenless Zone Zero: deskripsi Digiflazz `[UID][|Server]` dengan daftar
// server Asia / America / Europe / TW,HK,MO — sama seperti Genshin, jadi
// dropdown dipakai supaya `asia` atau `ASIA` tidak terkirim ke supplier.
const ZZZ_SERVER_OPTIONS = ["Asia", "America", "Europe", "TW/HK/MO"];

const ZZZ_SERVER: AccountField = {
  label: "Server / Region",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 8,
  sanitize: "identifier",
  pattern: /^(Asia|America|Europe|TW\/HK\/MO)$/,
  invalidMessage:
    "Pilih salah satu server: Asia, America, Europe, atau TW/HK/MO.",
  options: ZZZ_SERVER_OPTIONS,
};

// Ragnarok M: Eternal Love — lima server resmi. Server berupa nama dengan
// spasi, jadi TIDAK boleh jadi kolom numerik.
const RAGNAROK_SERVER_OPTIONS = [
  "Eternal Love",
  "Midnight Party",
  "Memory Of Faith",
  "Valhalla Glory",
  "Port City",
];

const RAGNAROK_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 32,
  sanitize: "identifier",
  pattern: /^(Eternal Love|Midnight Party|Memory Of Faith|Valhalla Glory|Port City)$/,
  invalidMessage:
    "Pilih salah satu server: Eternal Love, Midnight Party, Memory Of Faith, Valhalla Glory, atau Port City.",
  options: RAGNAROK_SERVER_OPTIONS,
};

// Heroes Evolved: deskripsi Digiflazz `[UID][|Server]` dan dokumentasi resminya
// "Enter your Player ID and select the game server". Daftar server tidak
// disebut, jadi server dibiarkan teks bebas.
const HEROES_EVOLVED_USER: AccountField = {
  label: "Player ID",
  placeholder: "Masukkan Player ID Heroes Evolved",
  inputMode: "numeric",
  maxLength: 20,
  sanitize: "digits",
  pattern: /^\d{4,20}$/,
  invalidMessage: "Player ID harus 4-20 digit.",
};

// Server Heroes Evolved = wilayah regional, bukan shard per akun.
const HEROES_EVOLVED_SERVER_OPTIONS = ["Asia", "SEA", "NA", "SA", "EU"];

const HEROES_EVOLVED_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 8,
  sanitize: "identifier",
  pattern: /^(Asia|SEA|NA|SA|EU)$/,
  invalidMessage: "Pilih salah satu server: Asia, SEA, NA, SA, atau EU.",
  options: HEROES_EVOLVED_SERVER_OPTIONS,
};

// Teamfight Tactics Mobile: game-nya Riot, TAPI contoh ID dari supplier
// `123456780000` (12 digit numerik) dan SN-nya `Nickname+TrxID`. Jadi TIDAK
// mengikuti format Riot ID seperti League of Legends PC.
const TFT_MOBILE_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID Teamfight Tactics",
  inputMode: "numeric",
  maxLength: 14,
  sanitize: "digits",
  pattern: /^\d{8,14}$/,
  invalidMessage: "User ID harus 8-14 digit.",
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

  // Zenless Zone Zero: publisher sama dengan Genshin, dan deskripsi Digiflazz
  // memakai `[UID][|Server]` dengan daftar region yang sama. Dicabut sebelum
  // cabang Genshin supaya klausa `server`-nya ikut dipakai.
  if (/zenless|zzz/.test(identity)) {
    return {
      kind: "zenless-zone-zero",
      user: {
        label: "UID",
        placeholder: "Masukkan UID Zenless Zone Zero",
        inputMode: "numeric",
        maxLength: 10,
        sanitize: "digits",
        pattern: /^\d{9,10}$/,
        invalidMessage: "UID Zenless Zone Zero harus 9-10 digit.",
      },
      ...(requiresServer ? { server: ZZZ_SERVER } : {}),
      checker: "universal",
      helper: requiresServer
        ? "Masukkan UID dan pilih server/region akun Zenless Zone Zero."
        : "Masukkan UID akun Zenless Zone Zero.",
    };
  }

  // Honkai: Star Rail — publisher HoYoverse, sama seperti Genshin, dan daftar
// region-nya identik (Asia, America, Europe, TW/HK/MO). Field server-nya
// dipinjam dari `GENSHIN_SERVER` supaya tidak ada daftar region yang berbeda
// untuk game yang regionnya sama.
  if (/honkai|star rail|hsr/.test(identity)) {
    return {
      kind: "honkai-star-rail",
      user: {
        label: "UID",
        placeholder: "Masukkan UID Honkai: Star Rail",
        inputMode: "numeric",
        maxLength: 10,
        sanitize: "digits",
        pattern: /^\d{9,10}$/,
        invalidMessage: "UID Honkai: Star Rail harus 9-10 digit.",
      },
      ...(requiresServer ? { server: GENSHIN_SERVER } : {}),
      checker: "universal",
      helper: requiresServer
        ? "Masukkan UID dan pilih server/region akun Honkai: Star Rail."
        : "Masukkan UID akun Honkai: Star Rail.",
    };
  }

  // Ragnarok M: Eternal Love. Format Digiflazz `user_id|Server`, contoh
  // `123378499|Eternal Love`. Server berupa NAMA dengan spasi, jadi harus
  // teks — dan dibuat dropdown karena daftar servernya pendek dan tetap.
  if (/ragnarok|romg|eternal love/.test(identity)) {
    return {
      kind: "ragnarok-m",
      user: {
        label: "Character ID",
        placeholder: "Masukkan Character ID",
        inputMode: "numeric",
        maxLength: 12,
        sanitize: "digits",
        pattern: /^\d{5,12}$/,
        invalidMessage: "Character ID harus 5-12 digit.",
      },
      ...(requiresServer ? { server: RAGNAROK_SERVER } : {}),
      checker: null,
      helper: "Masukkan Character ID dan pilih server akun Ragnarok M.",
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

  // Valorant, Wild Rift, Legends of Runeterra, dan League of Legends PC
  // sama-sama game Riot — fulfillment-nya memakai Riot ID (Nama#Tag).
  //
  // League of Legends PC ikut di sini, bukan di numeric-player: Riot
  // menyatakan Riot ID berlaku lintas LoL, VALORANT, TFT PC, Wild Rift, dan
  // LoR. TFT Mobile sengaja TIDAK ikut — contoh ID dari supplier-nya numerik
  // dan SN-nya `Nickname+TrxID`.
  if (/valorant|\bvalo\b|wild rift|runeterra|league of legends/.test(identity)) {
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

  // Heroes Evolved: server-nya wilayah regional — channel tournament resmi
  // NetDragon hosting NORTH AMERICAN, SOUTH AMERICAN, dan SA/SEA, dan
  // komunitas menyebut NA, EU, SEA, serta Asia. Daftar wilayah ini stabil,
  // jadi aman dijadikan dropdown. Kalau publisher menambah wilayah baru,
  // cukup tambah satu baris di `HEROES_EVOLVED_SERVER_OPTIONS`.
  if (/heroes evolved/.test(identity)) {
    return {
      kind: "numeric-player",
      user: HEROES_EVOLVED_USER,
      ...(requiresServer ? { server: HEROES_EVOLVED_SERVER } : {}),
      checker: "universal",
      helper: "Masukkan Player ID dan pilih server wilayah akunmu.",
    };
  }

  // Teamfight Tactics Mobile: "Masukkan ID", contoh `123456780000`. Bukan
  // Riot ID meski games-nya sama dengan League of Legends.
  if (/teamfight tactics|\btft\b/.test(identity)) {
    return {
      kind: "numeric-player",
      user: TFT_MOBILE_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: null,
      helper: "Masukkan User ID Teamfight Tactics sesuai informasi akun di game.",
    };
  }

  // Dragon Nest M Classic & NBA Infinite. Keduanya punya `requires_server`
  // sendiri di tabel games karena deskripsi Digiflazz-nya
  // `[UID][|Server]` dan "Masukkan ID dan Server". Checker dimatikan: Volsever
  // tidak punya route untuk Dragon Nest, dan route NBA Infinite-nya sedang
  // berstatus `fail`.
  if (/dragon nest|\bdn\b/.test(identity) || /nba infinite/.test(identity)) {
    const isDragonNest = /dragon nest|\bdn\b/.test(identity);
    return {
      kind: "numeric-player",
      user: {
        ...DN_NBA_USER,
        label: isDragonNest ? "User ID" : "ID",
        placeholder: isDragonNest
          ? "Masukkan User ID Dragon Nest"
          : "Masukkan ID NBA Infinite",
      },
      ...(requiresServer
        ? { server: isDragonNest ? DRAGON_NEST_SERVER : NBA_INFINITE_SERVER }
        : {}),
      checker: null,
      helper: requiresServer
        ? "Masukkan ID dan Server sesuai informasi akun di game."
        : "Masukkan ID sesuai informasi akun di game.",
    };
  }

  // State of Survival: "Masukkan User ID." — tanpa server. Route Volsever-nya
  // ada tapi sedang `fail`, jadi checker dimatikan sampai diconfirmasi.
  if (/state of survival/.test(identity)) {
    return {
      kind: "numeric-player",
      user: STATE_OF_SURVIVAL_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: null,
      helper: "Masukkan User ID State of Survival dengan benar.",
    };
  }

  // Where Winds Meet: "Masukkan ID Akun".
  if (/where winds meet/.test(identity)) {
    return {
      kind: "numeric-player",
      user: WHERE_WINDS_MEET_USER,
      ...(requiresServer ? { server: GENERIC_NUMERIC_SERVER } : {}),
      checker: "universal",
      helper: "Masukkan ID Akun Where Winds Meet dengan benar.",
    };
  }

  if (
    /free fire|\bff\b|pubg|honor of kings|\bhok\b|arena of valor|\baov\b|delta force|fc mobile|marvel rivals|aniimo|call of duty|\bcod\b/.test(
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
  //
  // Xbox masuk sini meski deskripsi Digiflazz-nya tidak menyebut target apa
  // pun ("Stock Sendiri"): API Digiflazz tetap mewajibkan `customer_no`, jadi
  // email atau nomor HP dipakai sebagai kontak referensi — sama seperti
  // Steam, PSN, dan Google Play.
  if (/steam|google play|playstation|\bgarena\b|efootball|\bxbox\b/.test(identity)) {
    return {
      kind: "contact",
      user: CONTACT_USER,
      ...(requiresServer ? { server: GENERIC_SERVER } : {}),
      checker: null,
      helper:
        "Kode voucher dikirim ke halaman status order. Masukkan email atau nomor HP aktif sebagai referensi pengiriman.",
    };
  }

  // Pulsa operator, dompet digital, dan langganan yang terikat nomor HP.
// Vidio masuk sini karena deskripsi Digiflazz-nya "Nomor tujuan diisi dengan
// nomor hp yang terdaftar di Vidio" — bukan email.
  if (
    /telkomsel|indosat|\bxl\b|axis|\btri\b|smartfren|by u|\bdana\b|go pay|gopay|\bovo\b|shopee pay|link aja|vidio/.test(
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
