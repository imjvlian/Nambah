import type { ReactNode } from "react";

/**
 * Ikon navigasi admin.
 *
 * DIGAMBAR SEBAGAI SVG SEBARIS, bukan font ikon atau pustaka ikon.
 *
 * Alasannya ukuran. Font ikon menambah puluhan kilobyte ke setiap halaman
 * yang memakainya - ada di setiap route yang memakai `.acc-sidebar`, bukan
 * hanya di halaman admin. Empat belas kotak SVG menambah beberapa ratus
 * byte per halaman dan tidak menambah request network sama sekali.
 * Pola ini sama dengan yang dipakai `merchant/page.tsx`.
 *
 * SEMUA IKON BERGAYA SAMA:
 *
 * - `viewBox="0 0 24 24"`, tanpa `width`/`height` supaya ukuran diambil
 *   dari CSS dan ikon ikutotlewhen lagi besar di layar ponsel.
 * - `stroke="currentColor"` supaya warna mengikuti state tombol, termasuk
 *   ketika seksi sedang aktif.
 * - `strokeWidth="1.7"`, `strokeLinecap/Linejoin="round"`. Ketiga angka
 *   ini tidak boleh berbeda antar ikon - kalau satu ikon lebih tebal,
 *   terbaca sebagai seksi yang "lebih penting", dan itu pesan palsu.
 * - `aria-hidden="true"`. Ikon di sini murni dekoratif; nama seksi sudah
 *   ada sebagai teks di sebelahnya, jadi pembaca layar tidak perlu
 *   membacanya dua kali.
 *
 * Bentuknya dipilih supaya dapat dibedakan di ukuran 16-18px tanpa saling
 * tumpang tindih, bukan asal berbeda: pada ukuran sekecil itu, bentuk yang
 * mirip membuat dua ikon yang berbeda sulit dibedakan.
 */

type IconProps = { className?: string };

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/* --- Operasional ---------------------------------------------------- */

/** Ringkasan: dasbor empat kotak. */
export function IconOverview({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z" />
    </Icon>
  );
}

/** Pesanan: keranjang belanja. */
export function IconOrders({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 6h16l-1.4 10.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8z" />
      <path d="M9 6V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V6" />
    </Icon>
  );
}

/** Bukti transfer: dokumen dengan tanda centang. */
export function IconReceipts({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 3h12v18l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </Icon>
  );
}

/* --- Katalog -------------------------------------------------------- */

/** Produk: kotak bertumpuk. */
export function IconCatalog({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </Icon>
  );
}

/** Promo: tiket diskon. */
export function IconPromotions({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M14.5 9.5 9.5 14.5" />
      <circle cx="10.4" cy="9.9" r=".9" />
      <circle cx="13.6" cy="14.1" r=".9" />
    </Icon>
  );
}

/** Supplier: truk. */
export function IconSupplier({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 6h10v10H3zM13 9h4l3 3v4h-7z" />
      <circle cx="7" cy="18" r="1.7" />
      <circle cx="17" cy="18" r="1.7" />
    </Icon>
  );
}

/* --- Keuangan -------------------------------------------------------- */

/**
 * Transaksi: daftar baris.
 *
 * Sengaja BERBEDA dari `IconCashflow`. Keduanya sama-sama soal uang dan
 * sama-sama berada di grup Keuangan, jadi bentuknya dibuat jelas berbeda:
 * yang ini daftar transaksi per baris, yang lain grafik naik-turun.
 */
export function IconTransactions({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r=".9" />
      <circle cx="4" cy="12" r=".9" />
      <circle cx="4" cy="18" r=".9" />
    </Icon>
  );
}

/** Arus kas: grafik batang naik-turun. */
export function IconCashflow({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 20V9M9.3 20V4M14.7 20v-7M20 20v-4" />
    </Icon>
  );
}

/**
 * Rekonsiliasi: timbangan.
 *
 * Ikon ini mewakili pemeriksaan invariants, bukan "dokumen biasa" -
 * itu sebabnya memakai timbangan dan bukan lembar.
 */
export function IconFinance({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 4v16M7 20h10" />
      <path d="M4 9h16M4 9l-2 5a2.6 2.6 0 0 0 4 0zM20 9l-2 5a2.6 2.6 0 0 0 4 0z" />
    </Icon>
  );
}

/** Toko ritel: etalase toko. */
export function IconMerchants({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 9h16v11H4z" />
      <path d="M3 9l1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9z" />
      <path d="M9.5 20v-6h5v6" />
    </Icon>
  );
}

/** Afiliasi: orang-orangan terhubung. */
export function IconAffiliates({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17.5" cy="9.5" r="2.4" />
      <path d="M16 15.4a4.6 4.6 0 0 1 4.5 4.6" />
    </Icon>
  );
}

/** Lacte Points: koin bertanda bintang. */
export function IconPoints({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m12 8.4 1.15 2.5 2.65.3-1.95 1.85.5 2.65L12 14.35l-2.35 1.4.5-2.65-1.95-1.85 2.65-.3z" />
    </Icon>
  );
}

/* --- Sistem --------------------------------------------------------- */

/** Pengguna: satu orang. */
export function IconUsers({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  );
}

/** Sistem: roda gigi. */
export function IconSystem({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2.1 1.2M17.4 15.3l2.1 1.2M4.5 16.5l2.1-1.2M17.4 8.7l2.1-1.2" />
    </Icon>
  );
}

/* --- Alat ----------------------------------------------------------- */
/*
 * Ikon untuk halaman terpisah di bawah `/admin`.
 *
 * Semuanya memakai gaya yang sama dengan ikon seksi - stroke 1.7, sudut
 * bulat, `currentColor`. Bedanya hanya bentuk: alat biasanya lebih
 * "kotak" dan seksi lebih "figuratif", supaya operator bisa membedakan
 * "halaman lain" dari "seksi lain" tanpa membaca teksnya.
 */

/** Panduan: buku terbuka. */
export function IconBook({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 6.5C10.5 5 8.4 4.4 5 4.5v13c3.4-.1 5.5.5 7 2 1.5-1.5 3.6-2.1 7-2v-13c-3.4-.1-5.5.5-7 2z" />
      <path d="M12 6.5v13" />
    </Icon>
  );
}

/** Scan katalog: kotak dengan garis pemindai. */
export function IconScan({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M4 12h16" />
    </Icon>
  );
}

/** Banner: gambar berbingkai. */
export function IconImage({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m4 17 4.5-4.5 3 3 3-3L20 17" />
    </Icon>
  );
}

/** Operations: denyut. */
export function IconPulse({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 12h4l2.5-6 4 12L16 12h5" />
    </Icon>
  );
}

/** Test lab: labu. */
export function IconFlask({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M9.5 3h5M10.5 3v6.2L5.9 17.3A2 2 0 0 0 7.7 20.5h8.6a2 2 0 0 0 1.8-3.2L13.5 9.2V3" />
      <path d="M7.4 14.5h9.2" />
    </Icon>
  );
}