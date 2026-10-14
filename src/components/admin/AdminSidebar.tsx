"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { isTestLabEnabled } from "@/lib/test-lab-access";

import {
  IconAffiliates,
  IconBook,
  IconCashflow,
  IconCatalog,
  IconFinance,
  IconFlask,
  IconImage,
  IconMapping,
  IconMerchants,
  IconOrders,
  IconOverview,
  IconPoints,
  IconPromotions,
  IconPulse,
  IconReceipts,
  IconScan,
  IconSupplier,
  IconSystem,
  IconTransactions,
  IconUsers,
} from "@/components/admin/AdminNavIcons";
import { useAdminSection } from "@/components/admin/AdminSectionContext";
import { BRAND } from "@/lib/brand";

/**
 * Sidebar admin - SATU-SATUNYA sumber navigasi di seluruh `/admin`.
 *
 * KENAPA FILE INI ADA
 *
 * Dulu setiap halaman admin punya shell-nya sendiri. `/admin` punya
 * sidebar, sedangkan `/admin/affiliates`, `/admin/banners`,
 * `/admin/digiflazz`, `/admin/operations`, dan `/admin/test-lab` tidak -
 * semuanya cuma punya tombol "← Control Center". Akibatnya ada dua
 * sistem navigasi yang tidak saling terhubung, dan empat halaman tidak
 * bisa gefunden kecuali operator sudah tahu URL-nya.
 *
 * Sidebar sekarang Taruh di `layout.tsx`, jadi otomatis berlaku untuk
 * SEMUA route di bawah `/admin`. Menambah halaman admin baru tidak
 * Sidebar sekarang taruh di `layout.tsx`, jadi otomatis berlaku untuk
 *
 * NAVIGASI ANTAR-ROUTE
 *
 * Item navigasi menunjuk ke section di dalam dashboard (`/admin?seksi=...`).
 * Dashboard membaca query itu lewat `useSearchParams`, jadi sidebar di
 * sini cukup menautkan URL dan tidak perlu tahu bentuk state internal
 * dashboard. Konsekuensinya: item sidebar yang sama berfungsi dari
 * dashboard maupun dari halaman terpisah.
 *
 * `external` menandai halaman yang punya arah navigasinya sendiri
 * (mis. katalog Digiflazz). Item seperti itu diberi penanda supaya
 * operator tahu dia akan pindah halaman, bukan berpindah seksi.
 */

export type AdminSectionId =
  | "overview"
  | "orders"
  | "receipts"
  | "transactions"
  | "catalog"
  | "promotions"
  | "supplier"
  | "cashflow"
  | "finance"
  | "merchants"
  | "points"
  | "affiliates"
  | "users"
  | "system";

export type AdminNavItem = {
  id: AdminSectionId;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
  hint: string;
  group: string;
  /**
   * Route yang punya halaman sendiri di luar dashboard.
   *
 * Item seperti ini diperlakukan sebagai navigasi ke halaman lain, bukan
 * sebagai section di dalam dashboard.
   * seksi di dashboard.
   */
  standaloneHref?: string;
  /** Route yang sedang aktif, dipakai untuk menandai butir. */
  activeHref?: string;
};

/**
 * Peta navigasi admin.
 *
 * `hint` menjelaskan apa yang ADA di halaman itu dalam satu kalimat.
 * Tanpa itu, "Transaksi", "Arus Kas", dan "Rekonsiliasi" terdengar seperti
 * tiga nama yang bersaing untuk hal yang sama - padahal yang satu
 * daftar per order, yang satu agregasi harian, dan yang satu pemeriksaan
 * invariants.
 *
 * `Icon` dipilih eksplisit, bukan diturunkan dari nama: nama seksi bisa
 * diubah kapan saja, dan ikonnya tidak ikut berganti kalau dipetakan
 * lewat string.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    id: "overview",
    label: "Ringkasan",
    Icon: IconOverview,
    hint: "Kondisi bisnis hari ini",
    group: "Operasional",
  },
  {
    id: "orders",
    label: "Pesanan",
    Icon: IconOrders,
    hint: "Pesanan masuk dan top up",
    group: "Operasional",
  },
  {
    id: "receipts",
    /*
     * Nama lama "Bukti Transfer" dengan keterangan "Verifikasi bukti
     * bayar" SALAH: halaman ini tidak memuat bukti transfer sama sekali.
     * Isinya adalah `receipt_deliveries` - log pengiriman EMAIL lewat
     * Brevo, lengkap dengan provider message id dan jumlah percobaan.
     *
     * Tidak ada alur verifikasi pembayaran manual di sistem ini, jadi
     * nama yang menyesatkan itu tidak pernah bisa dipenuhi. Sekarang
     * namanya apa adanya: apa yang halaman ini benar-benar lakukan.
     */
    label: "Log Email",
    Icon: IconReceipts,
    hint: "Pengiriman email bukti ke user",
    group: "Operasional",
  },
  {
    id: "transactions",
    label: "Transaksi",
    Icon: IconTransactions,
    hint: "Detail harga per order",
    group: "Operasional",
  },

  {
    id: "catalog",
    label: "Produk",
    Icon: IconCatalog,
    hint: "Item yang dijual",
    group: "Katalog",
  },
  {
    id: "promotions",
    label: "Promo",
    Icon: IconPromotions,
    hint: "Diskon dan kupon",
    group: "Katalog",
  },
  {
    id: "supplier",
    label: "Supplier",
    Icon: IconSupplier,
    hint: "Sumber dan harga modal",
    group: "Katalog",
  },

  {
    id: "cashflow",
    label: "Arus Kas",
    Icon: IconCashflow,
    hint: "Uang masuk dan keluar",
    group: "Keuangan",
  },
  {
    id: "finance",
    label: "Rekonsiliasi",
    Icon: IconFinance,
    hint: "Cek ulang angka",
    group: "Keuangan",
  },
  {
    id: "merchants",
    label: "Toko Ritel",
    Icon: IconMerchants,
    hint: "Piutang toko",
    group: "Keuangan",
  },

  {
    id: "points",
    label: "Lacte Points",
    Icon: IconPoints,
    hint: "Saldo dan poin user",
    group: "Pertumbuhan",
  },
  {
    id: "affiliates",
    label: "Afiliasi",
    Icon: IconAffiliates,
    hint: "Komisi dan pencairan",
    group: "Pertumbuhan",
  },

  {
    id: "users",
    label: "Pengguna",
    Icon: IconUsers,
    hint: "Akun dan akses",
    group: "Sistem",
  },
  {
    id: "system",
    label: "Sistem",
    Icon: IconSystem,
    hint: "Kesehatan dan konfigurasi",
    group: "Sistem",
  },
];

/**
 * Groups, URUTAN DARI PALING SERING DIPAKAI.
 *
 * Jumlah seksi per grup dijaga 2-4. Grup yang terlalu berisi sama saja
 * dengan tidak ada pengelompokan.
 *
 * Daftar ini harus mencakup semua nilai `group` di `ADMIN_NAV` dan
 * `ADMIN_TOOLS`: grup yang tidak terdaftar membuat isinya tidak muncul
 * sama sekali.
 *
 * PERUBAHAN v3
 *
 * "Alat" sebelumnya berisi enam halaman dan mencampur lima jenis
 * pekerjaan: dokumentasi (Panduan), pemeliharaan (Operations, Test Lab),
 * katalog supplier (Digiflazz), konten (Banner), dan uang keluar
 * (Pencairan Afiliasi). Satu grup untuk lima jenis pekerjaan hampir
 * sama dengan tidak mengelompokkan sama sekali.
 *
 * Yang dipindah:
 *   - Katalog Digiflazz ke "Katalog" - SKU-nya adalah sumber Produk
 *     dan Supply harga, jadi harus terbuka bersama keduanya.
 *   - Pencairan Afiliasi ke "Keuangan" - pasangan dari Toko Ritel:
 *     dua-duanya uang keluar yang dicatat satu per satu.
 *   - Banner Beranda ke "Pertumbuhan" - alat pemasaran, bukan alat
 *     teknis, dipakai tim yang sama dengan Points dan Afiliasi.
 *
 * "Program" diganti "Pertumbuhan" karena isinya bukan cuma program
 * loyalitas.
 *
 * Yang tersisa di "Alat" memang tiga: satu dibaca, dua dipakai saat
 * ada masalah. Itu satu jenis pekerjaan yang sama.
 */
export const ADMIN_NAV_GROUPS = [
  "Operasional",
  "Katalog",
  "Keuangan",
  "Pertumbuhan",
  "Sistem",
  "Alat",
] as const;

/**
 * Halaman terpisah yang punya arahnya sendiri.
 *
 * Dikelompokkan sebagai "Alat" supaya tidak tercampur dengan pekerjaan
 * harian. Semuanya dulu hanya bisa dicapai lewat link yang tersebar di
 * dalam halaman - sekarang ada di sidebar, jadi tidak perlu hafal URL.
 */
export const ADMIN_TOOLS: Array<{
  href: string;
  label: string;
  hint: string;
  group: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}> = [
  {
    href: "/admin/docs",
    label: "Panduan",
    hint: "Cara pakai tiap halaman",
    group: "Alat",
    Icon: IconBook,
  },
  {
    href: "/admin/digiflazz",
    label: "Katalog Digiflazz",
    hint: "Scan dan publish SKU",
    /*
     * Sempat di "Alat", padahal yang dilaluinya adalah sumber dari
     * dua halaman lain di grup ini: SKU yang di-scan di sini yang
     * muncul sebagai "Produk" dan priced oleh "Supplier". Memisahkannya
     * berarti operator harus tahu grup mana yang harus dibuka dulu.
     */
    group: "Katalog",
    Icon: IconScan,
  },
  {
    href: "/admin/melostore-mapping",
    label: "Katalog Melostore",
    hint: "Petakan SKU supplier kedua",
    /*
     * Digiflazz adalah sumber produk; Melostore adalah pemetaannya.
     * Keduanya satu urusan - katalog supplier - jadi masuk grup yang
     * sama dan berdampingan. Kalau dipisah ke grup lain, operator
     * yang mencari "supplier kedua" akan membuka grup ini dulu
     * dan tidak menemukannya.
     */
    group: "Katalog",
    Icon: IconMapping,
  },
  {
    href: "/admin/banners",
    label: "Banner Beranda",
    hint: "Kelola banner promosi",
    /* Alat pemasaran, bukan alat teknis. */
    group: "Pertumbuhan",
    Icon: IconImage,
  },
  {
    /*
     * Dulu route ini hanya bisa dicapai lewat link di dalam seksi
     * "Afiliasi" pada dashboard, dan namanya persis sama dengan seksi
     * itu - jadi operator tidak bisa menebak mana yang terbuka.
     *
     * Sekarang jadi butir tersendiri dengan nama yang menyebut isinya.
     * Seksi "Afiliasi" di dashboard tetap menangani komisi; halaman ini
     * menangani pencairan dananya - jadi ia masuk grup "Keuangan",
     * bersama Toko Ritel: sama-sama uang keluar yang dicatat satu per
     * satu, yang sebelumnya terpisah oleh beberapa grup.
     */
    href: "/admin/affiliates",
    label: "Pencairan Afiliasi",
    hint: "Review dan cairkan komisi",
    group: "Keuangan",
    Icon: IconAffiliates,
  },
  {
    href: "/admin/operations",
    label: "Operations Center",
    hint: "Kesehatan seluruh layanan",
    group: "Alat",
    Icon: IconPulse,
  },
  {
    href: "/admin/test-lab",
    label: "Laboratorium Uji",
    hint: "Uji alur supplier tanpa uang sungguhan",
    group: "Alat",
    Icon: IconFlask,
  },
];

/*
 * Kunci localStorage.
 *
 * Versinya naik (`.v3`) karena satu grup DIGANTI NAMA: "Program" menjadi
 * "Pertumbuhan". Kunci lama tidak memuat nama itu, jadi grup BARU akan
 * terbaca sebagai "tidak ada di daftar terlipat" - artinya selalu
 * terbuka. Gejalanya persis seperti grouping gagal.
 *
 * Versi `.v2` sebelumnya naik karena alasan yang lebih fundamental:
 * versi lama menyimpan daftar grup terlipat dengan default `[]`, yang
 * berarti semua grup TERBUKA. Default yang benar adalah semua terlipat.
 *
 * Kalau kunci tidak dinaikkan, nilai lama yang sudah tersimpan di
 * browser operator akan terbaca sebagai "preferensi sah" dan default
 * baru tidak akan pernah berlaku.
 *
 * Menaikkan kunci adalah cara yang benar di sini: preferensi lama bukan
 * keputusan yang perlu dipelihara, cuma artefak dari perilaku yang
 * memang salah atau dari nama yang sudah tidak dipakai.
 */
const STORAGE_KEY = "lacte.admin.nav.collapsed.v3";

/**
 * Sidebar yang dipakai semua route di `/admin`.
 *
 * `activeHref` dipakai untuk menandai butir yang sedang aktif. Nilai ini
 * dibaca dari pathname, jadi sidebar tetap benar di halaman terpisah
 * maupun di dashboard.
 */
export default function AdminSidebar({
  activeHref,
}: {
  /** Pathname saat ini, mis. `/admin/affiliates`. */
  activeHref: string;
}) {
  const pathname = usePathname();
  const { section: activeSection, setSection: selectSection } =
    useAdminSection();

  /*
   * Sidebar hanya perlu tahu pathname SAAT INI. Nilai `activeHref` yang
   * datang dari luar dipakai sebagai cadangan supaya komponen ini tetap
   * bisa diuji dan dirender tanpa Provider.
   */
  const currentPath = activeHref ?? pathname;

  /*
   * Alat uji fulfilment disembunyikan dari sidebar di build produksi.
   *
   * Nilainya diambil saat render, bukan saat modul dimuat, supaya keputusan
   * ini ikut berubah kalau env-nya berubah tanpa perlu restart.
   */
  const testLabEnabled = isTestLabEnabled();

  const [open, setOpen] = useState(false);
  /*
   * SEMUA grup terlipat pada kunjungan pertama.
   *
   * Default-nya semua grup TERBUKA, dan itu ternyata salah: sidebar
   * memuat 14 seksi + 5 halaman alat, jadi yang terlihat di layar hanya
   * beberapa bagian teratas, dan blok profil/Keluar terdorong keluar
   * jangkauan pada layar pendek. Operator harus menggulir untuk
   * menemukan halaman yang jarang dipakai.
   *
   * Terlipat membuat sidebar hanya menampilkan beberapa baris kelompok,
   * dan blok profil selalu terlihat. Grup yang sedang/page aktif TIDAK
   * PERNAH terlipat (lihat `holdsActive`), jadi layar tidak pernah
   * menampilkan konten yang tidak bisa ditemukan di navigasi.
   *
   * `null` berarti "belum dibaca dari localStorage" - dipakai supaya
   * render pertama tidak langsung menandai semuanya terlipat sebelum
   * preferensi sempat terbaca. Menunday sebentar lebih baik daripada
   * sidebar berkedip terlipat lalu terbuka.
   *
   * State ini dibaca di `useEffect`, bukan di awal render: membaca
   * localStorage saat render akan membuat HTML hasil server berbeda dari
   * hasil klien, dan itu berakhir sebagai hydration mismatch.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<string[] | null>(
    null,
  );

  /*
   * State terlipat dibaca dari `localStorage` setelah mount, bukan di
   * awal render. Membacanya di awal akan menyebabkan hydration mismatch:
   * HTML hasil server tidak tahu isinya, lalu hydration di klien langsung
   * berbeda. `useEffect` menutup celah itu.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCollapsedGroups(
            parsed.filter(
              (value): value is string => typeof value === "string",
            ),
          );
          return;
        }
      }
      // Belum pernah ada preferensi tersimpan: semua grup terlipat.
      setCollapsedGroups([...ADMIN_NAV_GROUPS]);
    } catch {
      // localStorage bisa diblokir (mode privat, kebijakan browser).
      // Default terlipat tetap lebih baik daripada gagal render.
      setCollapsedGroups([...ADMIN_NAV_GROUPS]);
    }
  }, []);

  useEffect(() => {
    // Jangan menulis sebelum preferensi dibaca, atau nilai default akan
    // menimpa apa pun yang sudah tersimpan.
    if (collapsedGroups === null) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(collapsedGroups),
      );
    } catch {
      // Diabaikan dengan sengaja - lihat catatan di effect sebelumnya.
    }
  }, [collapsedGroups]);

  /*
   * Kunci scroll halaman selama drawer terbuka.
   *
   * Tanpa ini, layer gelap menutupi layar tapi halaman di belakangnya
   * masih bisa digulir dengan jari - drawer terlihat tidak merespons.
   * Efek hanya dipasang saat drawer terbuka, jadi tidak ada listener
   * yang menggantung di halaman desktop.
   */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((current) => {
      const base = current ?? [...ADMIN_NAV_GROUPS];
      return base.includes(group)
        ? base.filter((value) => value !== group)
        : [...base, group];
    });
  }, []);

  return (
    <>
      {/*
       * Layer gelap + area ketuk. Hanya muncul di bawah 820px lewat CSS,
       * dan di luar viewport selama drawer tertutup - `visibility` dipakai
       * supaya `opacity: 0` tidak terus menahan klik di halaman.
       */}
      <button
        type="button"
        className="acc-drawer-scrim"
        aria-label="Tutup menu navigasi"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />

      {/*
       * Tombol buka drawer.
       *
       * Berada DI SINU, bukan di topbar tiap halaman, karena yang
       * dikendelnya adalah state sidebar - dan state itu milik sidebar.
       * Kalau tombolnya diletakkan di topbar, setiap halaman perlu
       * menyalin tombol yang sama DAN menyambungkannya ke state sidebar,
       * sehingga satu perubahan di sini harus diisi ulang di lima file.
       *
       * Diposisikan `fixed` karena di bawah 820px sidebar berubah jadi
       * drawer melayang: tidak ada lagi kolom tempat tombol ini berada.
       * Topbar tiap halaman menyisakan ruang kosong di kirinya lewat
       * `padding-left` supaya judul tidak tertutup.
       */}
      <button
        type="button"
        className="acc-drawer-toggle"
        aria-label={open ? "Tutup menu navigasi" : "Buka menu navigasi"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>

      <aside className="acc-sidebar">
        <Link className="acc-brand" href="/admin">
          <span className="brand-mark">
            <img src="/logo/lacte-logo.svg" alt="" />
          </span>
          <span>
            <b>{BRAND.shortName}</b>
            <small>Pusat kendali</small>
          </span>
        </Link>

        <nav className="acc-nav" aria-label="Navigasi admin">
          {ADMIN_NAV_GROUPS.map((group) => {
            /*
             * Alat uji fulfilment difilter, bukan disembunyikan lewat CSS.
             *
             * Di build produksi sidebar tidak boleh menampilkan entri "Staging
             * Test Lab": halamannya sudah redirect kalau diakses langsung, tapi
             * menampilkan pintasan ke halaman yang menolaknya hanya membiarkan
             * bahwa alatnya ada. Keduanya harus hilang.
             */
            const items = ADMIN_NAV.filter((item) => item.group === group);
            const tools = ADMIN_TOOLS.filter(
              (tool) =>
                tool.group === group &&
                !(tool.href === "/admin/test-lab" && !testLabEnabled),
            );

            if (items.length === 0 && tools.length === 0) return null;

            const holdsActive =
              items.some((item) => item.id === activeSection) ||
              tools.some((tool) => currentPath.startsWith(tool.href));

            // `collapsedGroups === null` selama `localStorage` belum dibaca.
            // `collapsedGroups === null` selama `localStorage` belum dibaca.
            // Nilai null berarti semua grup dianggap TERBUKA
            // sesaat: lebih baik sidebar terlihat lengkap sesaat daripada
            const collapsed =
              collapsedGroups !== null &&
              collapsedGroups.includes(group) &&
              !holdsActive;

            return (
              <div
                className={
                  collapsed ? "acc-nav-group collapsed" : "acc-nav-group"
                }
                key={group}
              >
                <button
                  type="button"
                  className="acc-nav-group-toggle"
                  aria-expanded={!collapsed}
                  aria-controls={`nav-group-${group}`}
                  onClick={() => {
                    if (holdsActive) return;
                    toggleGroup(group);
                  }}
                  title={
                    holdsActive
                      ? `${group} - sedang dibuka`
                      : collapsed
                        ? `Buka ${group}`
                        : `Tutup ${group}`
                  }
                >
                  <span className="acc-nav-group-label">{group}</span>
                  <span
                    className="acc-nav-group-chevron"
                    aria-hidden="true"
                  />
                </button>

                <div
                  className="acc-nav-group-items"
                  id={`nav-group-${group}`}
                  hidden={collapsed}
                >
                  {items.map((item) => {
                    const { Icon } = item;
                    const href = `/admin?seksi=${item.id}`;
                    const active = activeSection === item.id;

                    return (
                      <Link
                        key={item.id}
                        href={href}
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => {
                          /*
                           * Kalau sudah berada di dashboard, section
                           * diganti lewat konteks TANPA memuat ulang.
                           *
                           * `href` tetap dituliskan supaya tautannya
                           * tetap bisa dibuka di tab baru, bisa di
                           * middle-click, dan tetap punya URL yang bisa
                           * dibagikan - perilaku `preventDefault` hanya
                           * berlaku untuk klik biasa di halaman ini.
                           */
                          if (currentPath === "/admin") {
                            event.preventDefault();
                            selectSection(item.id);
                          }
                          setOpen(false);
                        }}
                      >
                        <span className="acc-nav-icon">
                          <Icon />
                        </span>
                        <span className="acc-nav-text">
                          <b>{item.label}</b>
                          <small>{item.hint}</small>
                        </span>
                      </Link>
                    );
                  })}

                  {tools.map((tool) => {
                    const active = currentPath.startsWith(tool.href);
                    const ToolIcon = tool.Icon;
                    return (
                      <Link
                        key={tool.href}
                        href={tool.href}
                        className={active ? "active" : ""}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span className="acc-nav-icon">
                          <ToolIcon />
                        </span>
                        <span className="acc-nav-text">
                          <b>{tool.label}</b>
                          <small>{tool.hint}</small>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <AdminSidebarFooter />
      </aside>
    </>
  );
}

/**
 * Blok profil + tombol keluar di dasar sidebar.
 *
 * Dipisah ke komponen sendiri supaya sidebar utama tidak ikut dirender ulang
 * setiap kali state lain berubah. `AdminSessionUser` diambil di sini lewat
 * endpoint sesi yang sama dengan yang dipakai dashboard.
 */
function AdminSidebarFooter() {
  const [user, setUser] = useState<{
    displayName: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          authenticated?: boolean;
          user?: { displayName?: string; role?: string };
        };
        if (!data.authenticated || !data.user) return;

        setUser({
          displayName: data.user.displayName ?? "Admin",
          role: data.user.role ?? "admin",
        });
      } catch {
        // Gagal memuat profil tidak boleh memblokir sidebar: navigasi
        // tetap harus bisa dipakai meski sesi tidak terbaca.
      }
    })();

    return () => controller.abort();
  }, []);

  return (
    <div className="acc-sidebar-foot">
      {user ? (
        <div className="acc-admin-user">
          <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.displayName}</strong>
            <small>{user.role}</small>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void (async () => {
            try {
              await Promise.all([
                fetch("/api/admin/session", { method: "DELETE" }),
                fetch("/api/auth/logout", {
                  method: "POST",
                  credentials: "same-origin",
                }),
              ]);
            } finally {
              window.location.replace("/login?next=%2Fadmin");
            }
          })();
        }}
      >
        Keluar
      </button>
    </div>
  );
}
