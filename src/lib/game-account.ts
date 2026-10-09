export type AccountGameDescriptor = {
  id: string;
  name: string;
  shortName?: string;
  requiresServer?: boolean;
};

/**
 * Satu pilihan di `<select>` server.
 *
 * Bentuk `{ value, label }` dipakai ketika nilai yang harus dikirim ke supplier
 * TIDAK sama dengan yang ditampilkan ke pelanggan. Contoh: Honkai Star Rail
 * mengirim `os_asia`, tapi pelanggan harus melihat "Asia" — bukan kode internal
 * yang tidak dia kenal.
 */
export type AccountFieldOption = string | { value: string; label: string };

/** Nilai yang benar-benar dikirim ke supplier untuk sebuah opsi. */
export function accountFieldOptionValue(option: AccountFieldOption): string {
  return typeof option === "string" ? option : option.value;
}

/** Label yang ditampilkan di `<select>`. */
export function accountFieldOptionLabel(option: AccountFieldOption): string {
  return typeof option === "string" ? option : option.label;
}

export type AccountField = {
  label: string;
  placeholder: string;
  inputMode: "numeric" | "text";
  maxLength: number;
  sanitize: "digits" | "username" | "identifier";
  pattern: RegExp;
  invalidMessage: string;
  // Bila terisi, field dirender sebagai <select> berisi nilai-nilai ini
  // (bukan input teks bebas). Penolakan nilai di luar daftar dilakukan oleh
  // `pattern` di atas, bukan oleh `options` — `options` hanya mengatur apa yang
  // bisa dipilih.
  options?: AccountFieldOption[];
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

// HoYoverse (Genshin, HSR, ZZZ). Deskripsi Seller di panel Digiflazz untuk
// Zenless Zone Zero (`MA***`):
//
//   "Format order : UID|Server uid,server uid|server uid(server)
//    uid (default asia) List Server :
//    Asia,os_asia,prod_official,asia,001
//    America,os_usa,002
//    Europe,os_euro,003
//    TW, HK, MO,os_cht,004"
//
// Tiga hal yang terkonfirmasi dari sini:
//
// 1. `|` adalah KARAKTER LITERAL, bukan notasi. Seller menulis tiga separator
//    yang berbeda (`uid,server`, `uid|server`, `uid(server)`) dalam satu
//    kalimat — kalau `|` cuma notasi, seller tidak akan menyebutnya eksplisit
//    di antara dua bentuk lain.
//
// 2. Nilai yang dikirim boleh berupa kode `os_*` (`os_asia`, `os_usa`,
//    `os_euro`, `os_cht`) ATAU nama (`Asia`, `asia`, `America`, `TW, HK, MO`)
//    ATAU angka (`001`-`004`).
//
// 3. UID saja sah — `uid (default asia)`. Ini menjelaskan kenapa template
//    lama `{user_id}` "tampak" benar: tanpa server, order tetap jalan dengan
//    default Asia. Tapi pilihan pelanggan jadi tidak berguna, dan akun
//    Asia/Amerika/Eropa/TW akan salah hasil.
//
// Yang dikirim tetap `os_*`: satu kode tanpa spasi, tanpa tanda baca, dan
// tanpa bergantung pada kapitalisasi. Bandingkan "TW, HK, MO" yang mengandung
// koma — koma adalah separator, jadi bentuk itu tidak bisa dipakai di dalam
// `customer_no` yang dipisah `|`.
const HOYOVENSE_SERVER_OPTIONS: AccountFieldOption[] = [
  { value: "os_asia", label: "Asia (os_asia)" },
  { value: "os_usa", label: "America (os_usa)" },
  { value: "os_euro", label: "Europe (os_euro)" },
  { value: "os_cht", label: "TW / HK / MO (os_cht)" },
];

const HOYOVENSE_SERVER: AccountField = {
  label: "Server / Region",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 8,
  sanitize: "identifier",
  pattern: /^(os_asia|os_usa|os_euro|os_cht)$/,
  invalidMessage:
    "Pilih salah satu server: Asia, America, Europe, atau TW/HK/MO.",
  options: HOYOVENSE_SERVER_OPTIONS,
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

// NBA Infinite. Wilayahnya memang lima (filter server di halaman top-up
// kaleoz.com: "Oceania, LATAM, NA, Asia, Europe"), TAPI nilai yang dikirim ke
// supplier adalah kode angka, bukan nama wilayah.
//
// Sumber: tabel format order reseller Digiflazz (kuotapulsa.com, post "Server
// NBA Infinite"):
//
//   Format tujuan : User ID,Server      <- pemisah KOMA, bukan pipe
//   Contoh : 12345,1001
//   1001 = Oceania   5001 = SouthAmerica   6001 = NA   7001 = Asia   8001 = Europe
//
// Perhatikan "LATAM" di sumber resmi ditulis "SouthAmerica" di tabel reseller.
const NBA_INFINITE_SERVER_OPTIONS: AccountFieldOption[] = [
  { value: "1001", label: "Oceania (1001)" },
  { value: "5001", label: "South America / LATAM (5001)" },
  { value: "6001", label: "North America (6001)" },
  { value: "7001", label: "Asia (7001)" },
  { value: "8001", label: "Europe (8001)" },
];

const NBA_INFINITE_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "numeric",
  maxLength: 4,
  sanitize: "digits",
  pattern: /^(1001|5001|6001|7001|8001)$/,
  invalidMessage: "Pilih salah satu server yang terdaftar di dalam game.",
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

// Zenless Zone Zero memakai `HOYOVENSE_SERVER` — sumber formatnya persis
// Deskripsi Seller ZZZ di panel Digiflazz, jadi tidak perlu menebak.
// Lihat komentar `HOYOVENSE_SERVER`.

// Ragnarok M: Eternal Love — lima server resmi. Server berupa nama dengan
// spasi, jadi TIDAK boleh jadi kolom numerik.
//
// Ejaan "Memory of Faith" mengikuti situs resmi Ragnarok M ("our three servers
// (Eternal Love, Midnight Party, and Memory of Faith)"). Huruf kecil pada "of"
// bukan soal tampilan: nilai inilah yang dikirim ke supplier, dan perbedaan
// kapitalisasi bisa membuat seller menolaknya.
const RAGNAROK_SERVER_OPTIONS = [
  "Eternal Love",
  "Midnight Party",
  "Memory of Faith",
  "Valhalla Glory",
  "Port City",
];

const RAGNAROK_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "text",
  maxLength: 32,
  sanitize: "identifier",
  pattern: /^(Eternal Love|Midnight Party|Memory of Faith|Valhalla Glory|Port City)$/,
  invalidMessage:
    "Pilih salah satu server: Eternal Love, Midnight Party, Memory of Faith, Valhalla Glory, atau Port City.",
  options: RAGNAROK_SERVER_OPTIONS,
};

// Heroes Evolved. Deskripsi Digiflazz hanya menulis "Format no tujuan
// [UID]|[Server]" tanpa daftar server, jadi daftar ini diambil dari tabel
// format order reseller Digiflazz (kuotapulsa.com, post "Server Heroes
// Evolved"):
//
//   Format tujuan : User ID,Server      <- pemisah KOMA, bukan pipe
//   Contoh : 12345,100
//
// Region resminya memang empat (NetDragon: "NA region... SA region... EU
// region... AS region"), dan TIDAK ada region bernama SEA. Yang paling mendekati
// SEA adalah `134`/`135`, server berbahasa Thailand.
//
// Nilai yang dikirim adalah ANGKA, bukan "NA"/"Asia". Karena itu label dan
// value dipisah: pelanggan melihat nama server, supplier menerima kodenya.
const HEROES_EVOLVED_USER: AccountField = {
  label: "Player ID",
  placeholder: "Masukkan Player ID Heroes Evolved",
  inputMode: "numeric",
  maxLength: 20,
  sanitize: "digits",
  pattern: /^\d{4,20}$/,
  invalidMessage: "Player ID harus 4-20 digit.",
};

const HEROES_EVOLVED_SERVER_OPTIONS: AccountFieldOption[] = [
  { value: "100", label: "North America - LOST TEMPLE (100)" },
  { value: "101", label: "North America - NEW ORDER (101)" },
  { value: "111", label: "Europe - ASGARD (111)" },
  { value: "112", label: "Europe - OLYMPUS (112)" },
  { value: "121", label: "South America - AMAZON (121)" },
  { value: "122", label: "South America - EL DORADO (122)" },
  { value: "131", label: "Asia - ANGKOR (131)" },
  { value: "132", label: "Asia - SHANGRI-LA (132)" },
  { value: "133", label: "Asia - EL NIDO (133)" },
  { value: "134", label: "Asia - Thailand (134)" },
  { value: "135", label: "Asia - Thailand 2 (135)" },
];

const HEROES_EVOLVED_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "numeric",
  maxLength: 3,
  sanitize: "digits",
  pattern: /^(100|101|111|112|121|122|131|132|133|134|135)$/,
  invalidMessage: "Pilih salah satu server yang terdaftar di dalam game.",
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

// ── Katalog baru (2026-10-09) ────────────────────────────────────────────
//
// Delapan game yang masuk katalog lewat `catalog-sync` tanpa schema khusus,
// sebelumnya jatuh ke cabang `generic` paling bawah `getGameAccountSchema`.
// Cabang itu menerima teks bebas 3-64 karakter — terlalu longgar untuk ID
// yang semua sumber independen sebutkan sebagai angka. Kalau ID salah,
// validasi kita lolos lalu order-nya ditolak supplier SETELAH pembayaran.

// LifeAfter Credits. Publisher NetEase, produk "Credits".
//
// Dua kolom, keduanya wajib. NetEase di pay.neteasegames.com/lifeafter/topup:
// "Masukkan LifeAfter User ID Anda dan pilih server game".
//
// Yang dikirim ke supplier adalah KODE server enam digit, bukan nama server —
// contoh order dari panel Digiflazz: `123456|500001`. Karena itu value dan
// label dipisah: pelanggan melihat "MiskaTown (NA)", supplier menerima 500001.
//
// Sembilan puluh server. Semuanya dipakai sebagai dropdown, bukan teks bebas:
// nama server LifeAfter mencakup Mandarin, katakana, hangul, dan titik
// ("St.Rona"), jadi mengetiknya manual hampir pasti salah ketik.
const LIFEAFTER_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID LifeAfter",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{6,12}$/,
  invalidMessage: "User ID LifeAfter harus 6-12 digit.",
};

const LIFEAFTER_SERVER_OPTIONS: AccountFieldOption[] = [
  { value: "500001", label: "MiskaTown (NA)" },
  { value: "500002", label: "SandCastle (NA)" },
  { value: "500003", label: "MouthSwamp (NA)" },
  { value: "500004", label: "RedwoodTown (NA)" },
  { value: "500005", label: "Obelisk (NA)" },
  { value: "500006", label: "NewLand (NA)" },
  { value: "500007", label: "ChaosOutpost (NA)" },
  { value: "500008", label: "IronStride (NA)" },
  { value: "500009", label: "CrystalthornSea (NA)" },
  { value: "510001", label: "FallForest (AU)" },
  { value: "510002", label: "MountSnow (AU)" },
  { value: "520001", label: "NancyCity (SEA)" },
  { value: "520002", label: "CharlesTown (SEA)" },
  { value: "520003", label: "SnowHighlands (SEA)" },
  { value: "520004", label: "Santopany (SEA)" },
  { value: "520005", label: "LevinCity (SEA)" },
  { value: "520006", label: "MileStone (SEA)" },
  { value: "520007", label: "ChaosCity (SEA)" },
  { value: "520008", label: "TwinIslands (SEA)" },
  { value: "520009", label: "HopeWall (SEA)" },
  { value: "520010", label: "LabyrinthSea (SEA)" },
  { value: "530001", label: "多貝雪山 (HMT)" },
  { value: "530002", label: "觸星山脈 (HMT)" },
  { value: "530003", label: "諾倫半島 (HMT)" },
  { value: "530004", label: "長嶺舊港 (HMT)" },
  { value: "530005", label: "平樂古城 (HMT)" },
  { value: "530006", label: "聖托帕尼 (HMT)" },
  { value: "530007", label: "貝侖草原 (HMT)" },
  { value: "530008", label: "墜星海畔 (HMT)" },
  { value: "530009", label: "梅爾醫院 (HMT)" },
  { value: "530010", label: "萊文市 (HMT)" },
  { value: "530011", label: "方舟基地 (HMT)" },
  { value: "530012", label: "重啟之地 (HMT)" },
  { value: "530013", label: "地下城 (HMT)" },
  { value: "530014", label: "希望之牆 (HMT)" },
  { value: "530015", label: "深海秘境 (HMT)" },
  { value: "540001", label: "秋の森林 (JP)" },
  { value: "540002", label: "砂石の城 (JP)" },
  { value: "540003", label: "ドベ雪山 (JP)" },
  { value: "540004", label: "レイヴン市 (JP)" },
  { value: "540005", label: "赤杉町 (JP)" },
  { value: "540006", label: "新生の地 (JP)" },
  { value: "540007", label: "混沌の城 (JP)" },
  { value: "540008", label: "希望の壁 (JP)" },
  { value: "540009", label: "棘の海域 (JP)" },
  { value: "550001", label: "파플래닛 (KR)" },
  { value: "550002", label: "미스카대학 (KR)" },
  { value: "550003", label: "희망의골짜기 (KR)" },
  { value: "550004", label: "다베트설산 (KR)" },
  { value: "550005", label: "가을빛산림 (KR)" },
  { value: "550006", label: "스노우힐 (KR)" },
  { value: "560001", label: "FallForest (EU)" },
  { value: "560002", label: "HopeValley (EU)" },
  { value: "560003", label: "SandCastle (EU)" },
  { value: "560004", label: "MountSnow (EU)" },
  { value: "560005", label: "St.Rona (EU)" },
  { value: "560006", label: "Oasis (EU)" },
  { value: "560007", label: "SilentIsland (EU)" },
  { value: "560008", label: "ArkCity (EU)" },
  { value: "570001", label: "AsiaSurvival (JP)" },
  { value: "570002", label: "ラッキーサバイバル (JP)" },
  { value: "570003", label: "リバースデー (JP)" },
  { value: "570004", label: "釣りライフ (JP)" },
  { value: "570005", label: "サイボーグ覚醒 (JP)" },
  { value: "700001", label: "簡單生存服 (HMT)" },
  { value: "700002", label: "鷺水度假村 (HMT)" },
  { value: "710001", label: "イージーサバイバル (JP)" },
  { value: "710002", label: "まったり村 (JP)" },
  { value: "720001", label: "SimpleSurvival (NA)" },
  { value: "730001", label: "EasySurvival (SEA)" },
];

const LIFEAFTER_SERVER: AccountField = {
  label: "Server",
  placeholder: "Pilih server",
  inputMode: "numeric",
  maxLength: 6,
  sanitize: "digits",
  pattern: /^\d{6}$/,
  invalidMessage: "Pilih salah satu server yang terdaftar di dalam game.",
  options: LIFEAFTER_SERVER_OPTIONS,
};

// One Punch Man: The Strongest. User ID saja, TANPA kolom server.
//
// kolom Deskripsi Seller di panel Digiflazz (produk pre34663356, seller OPM1):
//
//   "Tujuan = ID saja salah otomatis gagal"
//
// while Deskripsi Produk untuk SKU yang sama menulis
// `Format no tujuan [UID]|[Server]`. Seller yang benar-benar menerima order
// tidak meminta server, jadi tabel reseller pihak ketiga yang menyebut
// "User ID + Server ID" (Codashop, MooGold, KZStore) tidak diikut.
const ONE_PUNCH_MAN_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID One Punch Man",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{6,12}$/,
  invalidMessage: "User ID harus 6-12 digit.",
};

// Tom and Jerry: Chase. Publisher NetEase. Player ID saja, TANPA kolom server.
//
// Deskripsi Seller, dua seller independen (produk pre34663343 dan pre34663344):
//
//   "Tujuan = User ID"
//   "Tujuan = User ID (Server Tidak Perlu)"
//
// Pernah kolom server ada di sini, bersandar pada Codashop SG dan itemku yang
// menulis "Chase, for example: 11777888, Asia, iTeMkU". Keduanya pihak ketiga,
// dan keduanya bertentangan dengan seller sebenarnya. Meminta server untuk game
// yang hanya butuh ID berarti order ditolak setelah pelanggan membayar.
const TOM_JERRY_USER: AccountField = {
  label: "Player ID",
  placeholder: "Masukkan Player ID",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{6,12}$/,
  invalidMessage: "Player ID Tom and Jerry: Chase harus 6-12 digit.",
};

// ID-saja. Lima game; masing-masing punya sumber independen sendiri, jadi
// placeholder-nya menyebut nama game itu — bukan teks generik.

// Laplace M: Character ID numerik, dilihat di profil.
// Codashop Support: "User ID akan dapat dilihat pada profil".
const LAPLACE_M_USER: AccountField = {
  label: "Character ID",
  placeholder: "Masukkan Character ID",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{5,12}$/,
  invalidMessage: "Character ID harus 5-12 digit.",
};

// Lords Mobile: IGG ID numerik, 10 digit pada contoh reseller.
// Gravitas & Synapse: "Contoh: 4295037856".
const LORDS_MOBILE_USER: AccountField = {
  label: "IGG ID",
  placeholder: "Contoh: 4295037856",
  inputMode: "numeric",
  maxLength: 12,
  sanitize: "digits",
  pattern: /^\d{8,12}$/,
  invalidMessage: "IGG ID harus 8-12 digit.",
};

// Speed Drifters. Deskripsi Digiflazz-nya "-", dan TIDAK ADA satu pun sumber
// yang menyebut server — bukan satu pun dari lima:
//
//   KALEOZ:  "[INSTANT] Garena Speed Drifters UID ONLY"
//   MooGold: "Only Player ID Required"
//   UniPin:  "Enter User ID" (Settings → General)
//   Uquid:   "Enter your Player ID" + "Not for International and Vietnam Server"
//   Kaisar:  "Masukkan ID"
//
// Untuk game Garena, ID-nya berumur panjang dan bisa sangat panjang, jadi batasnya
// dibanding game lain.
const SPEED_DRIFTERS_USER: AccountField = {
  label: "Player ID",
  placeholder: "Masukkan Player ID",
  inputMode: "numeric",
  maxLength: 20,
  sanitize: "digits",
  pattern: /^\d{4,20}$/,
  invalidMessage: "Player ID harus 4-20 digit.",
};

// Werewolf (Party Game). Hanya User ID — Uquid: "Tap your Profile to get your
// User ID and User Name". Tidak ada sumber yang menyebut server.
const WEREWOLF_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID",
  inputMode: "numeric",
  maxLength: 16,
  sanitize: "digits",
  pattern: /^\d{4,16}$/,
  invalidMessage: "User ID harus 4-16 digit.",
};

// AU2 Mobile. Mayoritas reseller hanya minta User ID: SEAGM dan Uquid eksplisit
// "Only User ID is needed", TokoVCR dan KuponTop menyebut satu langkah
// ("Masukkan User ID"). Codashop KHM juga tanpa server.
const AU2_MOBILE_USER: AccountField = {
  label: "User ID",
  placeholder: "Masukkan User ID",
  inputMode: "numeric",
  maxLength: 16,
  sanitize: "digits",
  pattern: /^\d{4,16}$/,
  invalidMessage: "User ID harus 4-16 digit.",
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
      ...(requiresServer ? { server: HOYOVENSE_SERVER } : {}),
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
      ...(requiresServer ? { server: HOYOVENSE_SERVER } : {}),
      checker: "universal",
      helper: requiresServer
        ? "Masukkan UID dan pilih server/region akun Zenless Zone Zero."
        : "Masukkan UID akun Zenless Zone Zero.",
    };
  }

  // Honkai: Star Rail — publisher HoYoverse, region dan format server identik
  // dengan Genshin dan ZZZ. Ketiganya memakai `HOYOVENSE_SERVER`, yang
  // sumbernya Deskripsi Seller di panel Digiflazz.
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
      ...(requiresServer ? { server: HOYOVENSE_SERVER } : {}),
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

  // ── Katalog baru (2026-10-09) ──────────────────────────────────────────
  //
  // Diletakkan sebelum cabang voucher di bawah karena salah satu game punya
  // publisher Garena (Speed Drifters) — kalau tidak, `\bgarena\b` akan
  // capturing-nya sebagai voucher dan meminta email, bukan Player ID.
  //
  // Kedelapan game ini sebelumnya jatuh ke cabang `generic` paling bawah:
  // teks bebas 3-64 karakter, tanpa server, tanpa checker. Sekarang semuanya
  // punya kolom yang persis, diturunkan dari sumber independen per game.

  // LifeAfter Credits: dua kolom wajib. Server dikirim sebagai kode angka.
  if (/lifeafter|life after/.test(identity)) {
    return {
      kind: "numeric-player",
      user: LIFEAFTER_USER,
      ...(requiresServer ? { server: LIFEAFTER_SERVER } : {}),
      checker: null,
      helper: "Masukkan User ID dan pilih server sesuai informasi akun LifeAfter.",
    };
  }

  // One Punch Man: The Strongest — User ID saja, tanpa kolom server.
  if (/one punch|\bopm\b/.test(identity)) {
    return {
      kind: "numeric-player",
      user: ONE_PUNCH_MAN_USER,
      checker: null,
      helper: "Masukkan User ID sesuai informasi akun di game.",
    };
  }

  // Tom and Jerry: Chase — Player ID saja. Seller di panel Digiflazz menulis
  // "Tujuan = User ID (Server Tidak Perlu)", jadi kolom server dihapus.
  if (/tom and jerry|\btjc\b|chase/.test(identity)) {
    return {
      kind: "numeric-player",
      user: TOM_JERRY_USER,
      checker: null,
      helper: "Masukkan Player ID sesuai informasi akun di game.",
    };
  }

  // Laplace M: Character ID numerik, tanpa server.
  if (/laplace/.test(identity)) {
    return {
      kind: "numeric-player",
      user: LAPLACE_M_USER,
      checker: null,
      helper: "Masukkan Character ID. ID bisa dilihat di profil karakter.",
    };
  }

  // Lords Mobile: IGG ID numerik 10 digit. Nomor kingdom TIDAK dikirim —
  // VGTopup: "Tanpa kotak server. Tanpa menu dropdown kingdom."
  if (/lords mobile|\blm\b/.test(identity)) {
    return {
      kind: "numeric-player",
      user: LORDS_MOBILE_USER,
      checker: null,
      helper: "Masukkan IGG ID sesuai informasi akun di game.",
    };
  }

  // Speed Drifters: Publisher Garena, jadi HARUS di atas cabang voucher
  // `\bgarena\b`. Hanya Player ID — tidak ada sumber yang menyebut server.
  if (/speed drifters|drifters/.test(identity)) {
    return {
      kind: "numeric-player",
      user: SPEED_DRIFTERS_USER,
      checker: null,
      helper: "Masukkan Player ID sesuai informasi akun di game.",
    };
  }

  // Werewolf (Party Game): hanya User ID.
  if (/werewolf|wolf party|party game/.test(identity)) {
    return {
      kind: "numeric-player",
      user: WEREWOLF_USER,
      checker: null,
      helper: "Masukkan User ID sesuai informasi akun di game.",
    };
  }

  // AU2 Mobile: hanya User ID.
  if (/au2|alpha ultra|ultraman/.test(identity)) {
    return {
      kind: "numeric-player",
      user: AU2_MOBILE_USER,
      checker: null,
      helper: "Masukkan User ID sesuai informasi akun di game.",
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
