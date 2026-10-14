/**
 * Hak akses admin per grup kerja.
 *
 * FUNGSI INI MURNI
 *
 * Tidak ada database, tidak ada request, tidak ada environment. Semuanya
 * masuk lewat parameter. Itu yang membuatnya bisa diuji seluruhnya -
 * termasuk fakta yang paling penting di sini: daftar route harus menutup
 * semua file yang ada, dan itu hanya bisa dibuktikan dengan membaca
 * filesystem.
 *
 * DUA PETA, DUA KEGUNAAN
 *
 * `SECTION_SCOPE` menjawab "section dashboard mana yang boleh dibuka".
 * `ROUTE_SCOPE` menjawab "endpoint mana yang boleh dipanggil".
 *
 * Keduanya harus konsisten. Sidebar yang disembunyikan hanya kosmetik:
 * operator yang menyimpan URL masih bisa menarik datanya langsung dari
 * endpoint. Sebaliknya, endpoint yang boleh dipanggil sementara section-nya
 * tersembunyi menghasilkan layar yang menolak permintaan sendiri - operator
 * melihat error padahal halamannya sebenarnya boleh dibuka.
 *
 * ARAH KEGAGALAN
 *
 * Route yang tidak ada di peta DITUTUP untuk role admin. Jadi route baru
 * yang ditambahkan tanpa entri akan gagal test `admin-scope`, dan kalau
 * test itu tetap terlewati, aksesnya masih tertutup - bukan terbuka.
 * Arah kegagalan yang berbahaya tidak mungkin terjadi karena lupa.
 *
 * TOKEN `legacy` SELALU PENUH
 *
 * Token API tidak punya akun, jadi tidak bisa diberi role. Ia tetap punya
 * akses penuh karena itu jalur pemulihan resmi; memblokirnya berarti satu
 * kesalahan konfigurasi tidak bisa diperbaiki dari antarmuka. Pengaman
 * lockout superadmin tetap berlaku - dua-duanya tidak bertentangan.
 */

export const ADMIN_SCOPES = [
  "operasional",
  "katalog",
  "keuangan",
  "pertumbuhan",
  "sistem",
  "alat",
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];

/**
 * Scope milik role `admin`.
 *
 * Empat grup kerja harian: melihat order, mengelola katalog, memeriksa
 * uang, dan menjalankan program pertumbuhan. `sistem` dan `alat` tidak
 * masuk - keduanya pekerjaan teknis, bukan pekerjaan operasional.
 */
const ADMIN_ROLE_SCOPES: readonly AdminScope[] = [
  "operasional",
  "katalog",
  "keuangan",
  "pertumbuhan",
];

/** Role yang selalu punya akses penuh. */
const FULL_ACCESS_ROLES = ["superadmin", "legacy"];

export function isAdminScope(value: unknown): value is AdminScope {
  return (
    typeof value === "string" &&
    (ADMIN_SCOPES as readonly string[]).includes(value)
  );
}

export function hasFullAdminAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.includes(role);
}

/** Scope yang boleh diakses sebuah role. */
export function allowedScopes(role: string): readonly AdminScope[] {
  if (hasFullAdminAccess(role)) return ADMIN_SCOPES;
  return ADMIN_ROLE_SCOPES;
}

export function canAccessScope(role: string, scope: AdminScope): boolean {
  if (hasFullAdminAccess(role)) return true;
  return allowedScopes(role).includes(scope);
}

/**
 * Section pertama yang boleh dibuka sebuah role.
 *
 * `null` berarti tidak ada satu pun section yang boleh dibuka - dan itu
 * jawaban yang benar ketika role belum diketahui, bukan kondisi error.
 * Menganggap role kosong sebagai "boleh semua" membuat sidebar berkedip
 * menampilkan menu penuh selama session masih dimuat.
 */
export function firstAllowedSection<S extends string>(
  role: string,
  order: readonly S[],
  scopeOf: (section: S) => AdminScope,
): S | null {
  for (const section of order) {
    if (canAccessScope(role, scopeOf(section))) return section;
  }
  return null;
}

/**
 * Peta section dashboard ke grup kerja.
 *
 * Satu sumber untuk sidebar DAN dashboard. Kalau masing-masing punya daftar
 * sendiri, cepat atau lambat keduanya akan berbeda - dan biasanya yang
 * berbeda adalah dashboard yang menampilkan section yang sidebar tidak
 * tawarkan.
 */
export const SECTION_SCOPE: Record<string, AdminScope> = {
  // Operasional
  overview: "operasional",
  orders: "operasional",
  receipts: "operasional",
  transactions: "operasional",
  // Katalog
  catalog: "katalog",
  promotions: "katalog",
  supplier: "katalog",
  // Keuangan
  cashflow: "keuangan",
  finance: "keuangan",
  merchants: "keuangan",
  // Pertumbuhan
  points: "pertumbuhan",
  affiliates: "pertumbuhan",
  // Sistem
  users: "sistem",
  system: "sistem",
};

/**
 * Halaman terpisah di luar dashboard, dipetakan ke grup yang sama dengan
 * section equivalent-nya.
 *
 * Dipakai untuk menyembunyikan butir sidebar. Endpoint-nya sendiri
 * dilindungi oleh `ROUTE_SCOPE` di bawah.
 */
export const TOOL_SCOPE: Record<string, AdminScope> = {
  "/admin/docs": "alat",
  "/admin/operations": "alat",
  "/admin/test-lab": "alat",
  "/admin/digiflazz": "katalog",
  "/admin/melostore-mapping": "katalog",
  "/admin/banners": "pertumbuhan",
  "/admin/affiliates": "keuangan",
};

/**
 * Peta nama grup di sidebar ke scope.
 *
 * Ditulis eksplisit, bukan diturunkan dengan `toLowerCase()`. Sidebar
 * memakai huruf besar untuk tampilan ("Katalog") sementara scope memakai
 * huruf kecil ("katalog"); menyatukan kedua bentuk itu membuat perubahan
 * kecil pada label sidebar ikut mengubah siapa yang boleh masuk.
 */
export const SIDEBAR_GROUP_SCOPE: Record<string, AdminScope> = {
  Operasional: "operasional",
  Katalog: "katalog",
  Keuangan: "keuangan",
  Pertumbuhan: "pertumbuhan",
  Sistem: "sistem",
  Alat: "alat",
};

/** Scope dari nama grup sidebar, atau `null` untuk grup yang tidak dikenal. */
export function groupScopeFor(group: string): AdminScope | null {
  return SIDEBAR_GROUP_SCOPE[group] ?? null;
}

/**
 * Peta endpoint admin ke grup kerja.
 *
 * Pencocokan memakai PREFIX, jadi `/api/admin/digiflazz` sekaligus menutupi
 * sebelas route di bawahnya tanpa harus menulis sebelas baris. Setiap baris
 * sengaja kasar: prefix yang terlalu sempit membuat route di bawahnya
 * tidak punya scope dan akan tertutup tanpa disengaja.
 *
 * Route yang tidak disebut DI BAWAH ini tertutup untuk role `admin`.
 */
export const ROUTE_SCOPE: ReadonlyArray<readonly [string, AdminScope]> = [
  // -- Operasional -------------------------------------------------------
  ["/api/admin/overview", "operasional"],
  ["/api/admin/orders", "operasional"],
  ["/api/admin/receipts", "operasional"],
  ["/api/admin/receipt-preview", "operasional"],
  ["/api/admin/transactions", "operasional"],

  // -- Katalog -----------------------------------------------------------
  ["/api/admin/catalog", "katalog"],
  ["/api/admin/promotions", "katalog"],
  ["/api/admin/melostore", "katalog"],
  ["/api/admin/digiflazz", "katalog"],

  /*
   * Pengecualian di dalam Katalog. Prefiks `/api/admin/digiflazz` membuka
   * semua route di bawahnya, termasuk route yang sebenarnya bukan katalog.
   *
   * `test-transaction` memanggil API supplier sungguhan. Di sandbox tidak
   * berbahaya, di production ia menghabiskan saldo supplier - jadi ia
   * pekerjaan teknis, bukan pengelolaan katalog. Prefiks yang lebih panjang
   * di sini menang atas prefiks digiflazz di atas.
   */
  [
    "/api/admin/digiflazz/test-transaction",
    "alat",
  ],

  // -- Keuangan ----------------------------------------------------------
  ["/api/admin/cash-flow", "keuangan"],
  ["/api/admin/finance", "keuangan"],
  ["/api/admin/reconciliation", "keuangan"],
  ["/api/admin/merchants", "keuangan"],
  ["/api/admin/merchant-payments", "keuangan"],
  // Pencairan Afiliasi ada di grup Keuangan, bukan Pertumbuhan: yang
  // dibuka halaman ini adalah pencairan dananya. Baris withdrawals di bawah
  // punya prefix lebih panjang, jadi tetap menang saat keduanya cocok.
  ["/api/admin/affiliates", "keuangan"],
  ["/api/admin/affiliates/withdrawals", "keuangan"],

  // -- Pertumbuhan -------------------------------------------------------
  ["/api/admin/points", "pertumbuhan"],
  ["/api/admin/affiliate-performance", "pertumbuhan"],
  ["/api/admin/affiliate-requests", "pertumbuhan"],
  ["/api/admin/affiliates/link", "pertumbuhan"],
  ["/api/admin/banners", "pertumbuhan"],
];

/**
 * Route yang TIDAK melewati `authorizeAdminRequest`.
 *
 * `/api/admin/session` memang tidak pernah memanggilnya - session harus
 * bisa dibaca supaya sisi klien bisa tahu role-nya, termasuk role yang
 * sedang terkunci. Kalau route ini ikut terkunci, admin yang salah
 * dikonfigurasi tidak punya cara menemukan bahwa dia salah dikonfigurasi.
 *
 * Daftar ini bukan cara membuka akses. Daftar ini hanya menyatakan "route ini
 * memang tidak lewat gerbang sama sekali", dan test memastikannya dengan
 * membaca file route-nya.
 */
export const ROUTES_WITHOUT_AUTHORIZATION = ["/api/admin/session"] as const;

/**
 * Route yang SENGAJA tidak punya scope, jadi tertutup untuk role admin.
 *
 * Daftar ini bukan sekadar dokumentasi - `admin-scope.test.ts` memakainya
 * untuk memastikan SETIAP file route ada di peta, di sini, atau di daftar
 * pengecualian. Route baru yang ditambahkan tanpa satu dari ketiganya akan
 * menggagalkan test, bukan diam-diam ikut tertutup dengan alasan yang tidak
 * jelas.
 *
 * Dicatat eksplisit supaya "tertutup" selalu merupakan keputusan yang terlihat,
 * bukan efek samping dari lupa menambahkan baris.
 */
export const ROUTES_INTENTIONALLY_CLOSED: ReadonlyArray<
  readonly [string, string]
> = [
  ["/api/admin/users", "Sistem - daftar customer bukan urusan operator"],
  [
    "/api/admin/admin-users",
    "Sistem - sudah superadminOnly, role admin berhenti lebih dulu",
  ],
  ["/api/admin/readiness", "Sistem - pemeriksaan konfigurasi produksi"],
  ["/api/admin/payment-settings", "Sistem - konfigurasi payment gateway"],
  ["/api/admin/supplier-balance", "Sistem - pemeriksaan saldo supplier manual"],
  ["/api/admin/operations/health", "Alat - Operations Center"],
  ["/api/admin/test-lab", "Alat - laboratorium uji fulfilment"],
  ["/api/admin/telegram", "Alat - pengiriman dan uji notifikasi Telegram"],
];

/**
 * Scope dari sebuah pathname, atau `null` kalau tidak dikenal.
 *
 * `null` berarti "tidak ada petanya", dan pemanggil harus menutup akses
 * untuk role admin. Tidak ada nilai default yang mengizinkan - itulah yang
 * membuat lupa menambahkan entri tidak berubah menjadi lubang.
 */
export function routeScopeFor(pathname: string): AdminScope | null {
  /*
   * Prefiks terpanjang menang. `/api/admin/affiliates/link` harus menang atas
   * `/api/admin/affiliates/withdrawals`, dan keduanya tidak boleh ikut
   * tertangkap prefix yang lebih umum.
   */
  let best: { scope: AdminScope; length: number } | null = null;

  for (const [prefix, scope] of ROUTE_SCOPE) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.length) {
        best = { scope, length: prefix.length };
      }
    }
  }

  return best?.scope ?? null;
}

export function canAccessRoute(role: string, pathname: string): boolean {
  if (hasFullAdminAccess(role)) return true;

  const scope = routeScopeFor(pathname);
  // Tanpa peta berarti tertutup. Itulah fail-closed.
  if (!scope) return false;

  return canAccessScope(role, scope);
}