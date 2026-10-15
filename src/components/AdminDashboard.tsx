"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIDR, suggestPriceFromCost } from "@/lib/pricing";
import { compareCatalogItems, extractNominalAmount } from "@/lib/nominal-sort";
import AdminCatalogTools from "@/components/AdminCatalogTools";
import PaymentGatewayPanel from "@/components/PaymentGatewayPanel";
import { useConfirm } from "@/components/AdminConfirmDialog";
import AffiliatePerformancePanel from "@/components/AffiliatePerformancePanel";
import AffiliateDirectoryPanel from "@/components/AffiliateDirectoryPanel";
import ReceiptPreview from "@/components/ReceiptPreview";
import { STATUS_LABEL as ORDER_STATUS_LABELS } from "@/lib/order-status-display";
import {
  canManageAdmins,
  wouldRemoveLastSuperadmin,
} from "@/lib/admin-access-rules";
import {
  canAccessScope,
  firstAllowedSection,
  SECTION_SCOPE,
} from "@/lib/admin-scope";
import { BRAND } from "@/lib/brand";

type AdminSection =
  | "overview"
  | "orders"
  | "catalog"
  | "supplier"
  | "receipts"
  | "points"
  | "finance"
  | "cashflow"
  | "transactions"
  | "merchants"
  | "promotions"
  | "affiliates"
  | "users"
  | "system";

const MERCHANT_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu persetujuan",
  active: "Aktif",
  frozen: "Dibekukan",
  inactive: "Nonaktif",
};

/**
 * Varian `.acc-status` yang dipakai untuk warna.
 *
 * `pending` memakai warna biru yang sama dengan `processing`, bukan warna
 * gagal: menunggu persetujuan bukan kegagalan, dan menandainya merah akan
 * membuat admin terburu-buru menutup antrean yang justru perlu dirawat.
 */
function merchantStatusClass(status: string): string {
  if (status === "pending") return "processing";
  if (status === "active") return "success";
  return "failed";
}


type AdminSessionUser = {
  email: string;
  displayName: string;
};

type CatalogProduct = {
  id: string;
  gameId: string;
  gameName: string;
  gameShortName: string;
  label: string;
  note: string | null;
  sellingPrice: number;
  referencePrice: number;
  active: boolean;
  sortOrder: number;
  /** SKU milik Lacte - dari generator, bukan kode supplier. */
  internalSku: string | null;
  supplier: {
    mapped: boolean;
    sku: string | null;
    cost: number | null;
    active: boolean;
    lastSyncedAt: string | null;
    ready: boolean;
  };
  melostore: {
    sku: string | null;
    cost: number | null;
  };
  /** Modal termurah antar supplier terpetakan - dasar margin & checkout. */
  cheapestCost: number | null;
};

type CatalogPayload = {
  stats: {
    total: number;
    active: number;
    mapped: number;
    ready: number;
    unmapped: number;
  };
  balance: {
    balance: number;
    reservedBalance: number;
    availableBalance: number;
    checkedAt: string | null;
    /** Saldo Melostore - null berarti belum pernah disinkron. */
    melostore: {
      availableBalance: number;
      checkedAt: string | null;
    } | null;
  };
  games: Array<{
    id: string;
    name: string;
    shortName: string;
    active: boolean;
  }>;
  products: CatalogProduct[];
};

type DraftProduct = {
  label: string;
  note: string;
  sellingPrice: string;
  referencePrice: string;
  active: boolean;
  /** SKU Digiflazz. Mapping disimpan di `supplier_products`.
   *
   * Bidang ini SENGAJA tetap satu - menggantinya dengan objek berisi
   * dua supplier akan memaksa seluruh jalur simpan dirombak. Mapping
   * Melostore disimpan terpisah lewat endpoint pemetaannya, karena
   * verifikasi keduanya beda sumber data.
   */
  supplierSku: string;
  /** SKU Melostore yang dipilih operator, belum tentu tersimpan. */
  melostoreSku: string;
  /** SKU internal Lacte - diedit manual atau dibuat generator. */
  internalSku: string;
};

type OverviewPayload = {
  generatedAt: string;
  stats: {
    ordersToday: number | null;
    successToday: number | null;
    pendingPayment: number | null;
    processing: number | null;
    failed: number | null;
    receiptsSent: number | null;
    receiptsFailed: number | null;
    activePromotions: number | null;
    activeAffiliates: number | null;
    supplierPending: number | null;
    receiptSending: number | null;
  };
  finance: {
    /** Omzet Lacte hari ini. Sudah dikurangi fee toko; ritel yang belum dibayar tidak ikut. */
    revenueToday: number;
    /** Nominal ritel yang top up-nya sudah terkirim tapi uangnya belum masuk. */
    retailReceivableToday: number;
    /** Order sukses hari ini yang tidak punya `paid_at`, jadi tidak terhitung di omzet. */
    ordersMissingPaidAt: number;
    supplierBalance: number;
    reservedBalance: number;
    availableBalance: number;
    balanceCheckedAt: string | null;
    /** Saldo Melostore - null berarti belum pernah disinkron. */
    melostoreBalance: number | null;
    melostoreCheckedAt: string | null;
  };
  recentOrders: AdminOrder[];
  system: {
    flowTest: boolean;
    fulfillmentMode: string;
    services: Array<{
      id: string;
      name: string;
      ready: boolean;
      detail: string;
      state: "live" | "test" | "planned" | "attention";
    }>;
  };
};

type AdminOrder = {
  id: string;
  status: string;
  finalPrice: number;
  targetUserId: string;
  targetServerId: string | null;
  receiptEmail?: string | null;
  customerUserId?: string | null;
  gameName: string;
  packageLabel: string;
  paymentName?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  fulfilledAt?: string | null;
};

type ReceiptRow = {
  id: number;
  orderId: string;
  channel: string;
  recipient: string;
  provider: string;
  status: string;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminPointsPayload = {
  stats: {
    accounts: number;
    outstanding: number;
    reserved: number;
    available: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
  };
  rules: {
    pointValueIdr: number;
    earnEveryIdr: number;
    minimumRedeem: number;
    redeemStep: number;
    maxRedeemRate: number;
  };
  accounts: Array<{
    userId: string;
    balance: number;
    reserved: number;
    available: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
    updatedAt: string;
  }>;
  ledger: Array<{
    id: number;
    userId: string;
    orderId: string | null;
    type: string;
    pointsDelta: number;
    reservedDelta: number;
    balanceAfter: number;
    reservedAfter: number;
    note: string | null;
    createdAt: string;
  }>;
};

type AffiliatePayload = {
  stats: {
    affiliates: number;
    active: number;
    pending: number;
    available: number;
    reserved: number;
    withdrawn: number;
    cancelled: number;
  };
  affiliates: Array<{
    code: string;
    displayName: string;
    userId: string | null;
    commissionRate: number;
    status: string;
    createdAt: string;
  }>;
  commissions: Array<{
    id: number;
    affiliateCode: string;
    orderId: string;
    baseProfit: number;
    rate: number;
    amount: number;
    status: string;
    availableAt: string | null;
    createdAt: string;
  }>;
};

type PromotionPayload = {
  promotions: Array<{
    code: string;
    name: string;
    type: "flat" | "percentage";
    value: number;
    minimumOrder: number;
    maxDiscount: number | null;
    stackableWithReferral: boolean;
    startsAt: string | null;
    endsAt: string | null;
    quota: number | null;
    quotaPerUser: number | null;
    active: boolean;
    productIds: string[];
    reserved: number;
    redeemed: number;
  }>;
};

type AdminOrderDetail = {
  order: Record<string, unknown>;
  payments: Array<Record<string, unknown>>;
  supplierTransactions: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  commissions: Array<Record<string, unknown>>;
  points: Array<Record<string, unknown>>;
  promotionRedemptions: Array<Record<string, unknown>>;
};

type AdminAccountsPayload = {
  admins: Array<{
    userId: string;
    role: "admin" | "superadmin";
    active: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    activeSuperadmins: number;
    email: string | null;
    displayName: string | null;
    whatsapp: string | null;
    /** Baris ini adalah akun yang sedang logged in. */
    isSelf: boolean;
  }>;
};

type AdminUsersPayload = {
  users: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    whatsapp: string | null;
    preferredReceiptChannel: string;
    profileUpdatedAt: string | null;
    orders: number;
    success: number;
    spend: number;
    lastOrderAt: string | null;
  }>;
  /** Jumlah seluruh akun terdaftar, bukan jumlah baris yang sedang tampil. */
  total: number;
};

type MerchantRow = {
  id: string;
  name: string;
  code: string;
  serviceFeeFlatIdr: number;
  paymentTermDays: number;
  status: "active" | "frozen" | "inactive";
  notes: string | null;
  createdAt: string;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  dueSoonCount: number;
};

type MerchantsPayload = {
  merchants: MerchantRow[];
  retailEnabled: boolean;
};

type MerchantForm = {
  /** Null = sedang membuat toko baru, bukan mengedit. */
  id: string | null;
  name: string;
  code: string;
  serviceFeeFlatIdr: string;
  paymentTermDays: string;
  status: "active" | "frozen" | "inactive";
  notes: string;
  resetPin: boolean;
};

/**
 * Form pelunasan merchant.
 *
 * `merchantId` null = form tertutup. Nilai nominaldefault-nya diisi dari
 * piutang yang sedang berjalan, jadi kasus umum (merchant melunasi semuanya)
 * cukup satu klik tanpa mengetik angka.
 */
type MerchantPaymentForm = {
  merchantId: string | null;
  merchantName: string;
  amount: string;
  method: "transfer" | "cash" | "other";
  reference: string;
  note: string;
};

/**
 * Form kosong untuk membuat toko baru.
 *
 * Default fee 3% dan termin 7 hari mengikuti keputusan bisnis awal. Bukan 0%
 * karena fee 0% akan terlihat seperti fiturnya rusak, dan bukan 10% karena
 * angka yang itu perlu dipilih dengan sengaja.
 */
function blankMerchantForm(): MerchantForm {
  return {
    id: null,
    name: "",
    code: "",
    serviceFeeFlatIdr: "0",
    paymentTermDays: "7",
    status: "active",
    notes: "",
    resetPin: false,
  };
}

type FinancePayload = {
  stats: {
    checked: number;
    ok: number;
    warning: number;
    error: number;
  };
  rows: Array<{
    orderId: string;
    result: "ok" | "warning" | "error";
    issues: Array<{
      code: string;
      severity: "warning" | "error";
      message: string;
      expected?: number | string;
      actual?: number | string;
    }>;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
    checkedAt: string;
  }>;
};

/**
 * Bentuk laporan arus kas yang dikembalikan `/api/admin/cash-flow`.
 *
 * Tipe ini diduplikasi dari `@/lib/cash-flow-rules` karena komponen tidak
 * boleh mengimpor modul `server-only`. Yang penting di sini adalah
 * `merchantServiceFee` dan `merchantReceivable`: keduanya adalah angka yang
 * SERING disalahbaca sebagai pendapatan Lacte, jadi keberadaan keduanya
 * di tipe ini pengingat bahwa keduanya ada dan bukan hal yang bisa
 * disembunyikan dari tampilan.
 */
type CashFlowPayload = {
  from: string;
  to: string;
  days: Array<{
    date: string;
    orders: number;
    grossRevenue: number;
    supplierCost: number;
    profit: number;
    merchantSettled: number;
    affiliatePaidOut: number;
    gatewayFee: number;
    cashIn: number;
    cashOut: number;
    netCash: number;
  }>;
  totals: {
    orders: number;
    grossRevenue: number;
    supplierCost: number;
    grossProfit: number;
    marginPercent: number;
    discounts: number;
    affiliateCommission: number;
    merchantServiceFee: number;
    merchantOrders: number;
    merchantReceivable: number;
    merchantSettled: number;
    merchantOutstanding: number;
    failedOrders: number;
    affiliatePaidOut: number;
    affiliatePaidCount: number;
    gatewayFee: number;
    cashIn: number;
    cashOut: number;
    netCash: number;
  };
  byMethod: Array<{
    paymentMethodId: string;
    orders: number;
    revenue: number;
    supplierCost: number;
    profit: number;
  }>;
  /** Pencairan di-ACC tapi belum ditransfer - angka titik waktu. */
  affiliateApprovedPending: number;
  affiliateApprovedPendingCount: number;
};

/**
 * Bentuk laporan transaksi dari `/api/admin/transactions`.
 *
 * `truncated` ada karena laporan bisa melebihi batas baris. Kalau tidak
 * ada penandanya, angka total akan terlihat lengkap padahal hanya sebagian
 * yang masuk - dan laporan keuangan yang terlihat lengkap tapi tidak
 * lengkap adalah jenis kesalahan yang paling mahal.
 */
type TransactionReportPayload = {
  from: string;
  to: string;
  truncated: boolean;
  totalFiltered: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  summary: {
    count: number;
    grossRevenue: number;
    merchantServiceFee: number;
    supplierCost: number;
    profit: number;
    marginPercent: number;
    excludedCount: number;
    merchantUnpaidCount: number;
    merchantUnpaidRevenue: number;
  };
  rows: Array<{
    id: string;
    created_at: string;
    status: string;
    gameName: string | null;
    productLabel: string | null;
    paymentName: string | null;
    reference_price: number;
    selling_price: number;
    final_price: number;
    supplier_cost: number;
    nambah_profit: number;
    merchant_id: string | null;
    service_fee_amount: number | null;
    target_user_id: string | null;
    receivable_paid_at: string | null;
  }>;
};

type ReadinessPayload = {
  version: string;
  stage: string;
  readyForStagingE2E: boolean;
  automatedProductionReady: boolean;
  blockers: number;
  stagingBlockers: number;
  warnings: number;
  fulfillmentMode: string;
  flowTest: boolean;
  midtransEnvironment: {
    server: string;
    client: string;
  };
  manualChecklist: string[];
  checks: Array<{
    id: string;
    label: string;
    scope: "staging" | "production";
    status: "pass" | "warning" | "blocker";
    detail: string;
  }>;
};

type BootstrapResult = {
  summary?: {
    autoMapped?: number;
    suggested?: number;
    unmapped?: number;
  };
};

/**
 * Peta seksi admin.
 *
 * `Icon` DIPILIH SECARA EKSPLISIT, bukan diturunkan dari nama. Alasan:
 * nama seksi bisa diubah kapan saja (mis. "Keuangan" menjadi
 * "Rekonsiliasi"), sementara ikonnya tidak ikut berganti kalau
 * dipetakan lewat string.
 *
 * `hint` menjelaskan apa yang ADA di seksi itu dalam satu kalimat. Tanpa
 * itu, "Keuangan" dan "Arus Kas" dan "Transaksi" terdengar seperti tiga
 * nama yang bersaing untuk hal yang sama - padahal yang satu
 * rekonsiliasi invariants, yang satu agregasi harian, dan yang satu daftar
 * per transaksi. Ketiganya memang perlu ada, tapi hanya yang pertama
 * bekerja di luar order.
 */
/**
 * Peta seksi diambil dari sidebar, bukan didefinisikan ulang di sini.
 *
 * Sidebar sekarang dirender `layout.tsx` untuk semua route `/admin`, jadi
 * dashboard hanya MEMAKAI peta itu - bukan memiliki versinya sendiri.
 * Dua salinan akan menyimpang begitu salah satunya diedit, dan yang
 * terlihat akibatnya bukan pesan error, melainkan submenu yang isinya
 * tidak cocok dengan isi halamannya.
 *
 * `NAV` masih dipakai di dalam dashboard untuk mencari section aktif dan
 * untuk handler `?seksi=`, jadi diekspor ulang di sini supaya pemanggil
 * lama tidak perlu tahu dari mana asalnya.
 */
import {
  ADMIN_NAV as NAV,
  ADMIN_NAV_GROUPS as NAV_GROUPS,
} from "@/components/admin/AdminSidebar";
import { useAdminSection } from "@/components/admin/AdminSectionContext";
import ReportRangePicker, {
  type ReportRangeValue,
} from "@/components/admin/ReportRangePicker";
import CollapsiblePanel from "@/components/admin/CollapsiblePanel";
import DateTimePicker from "@/components/admin/DateTimePicker";
import {
  gabungkanKandidat,
  gameCocokUntukProduk,
  urutkanKandidatMelostore,
} from "@/lib/suppliers/saran-sku";
import { generateInternalSku } from "@/lib/internal-sku";

export { NAV, NAV_GROUPS };

/**
 * Label status order.
 *
 * Sekarang diambil dari `@/lib/order-status-display`, sumber yang sama dengan
 * `/account`. Sebelumnya kedua dashboard punya nama berbeda untuk hal yang
 * sama — "Pending payment" di sini, "Menunggu pembayaran" di sana — jadi user
 * dan operator bicara dua bahasa berbeda untuk status yang identik.
 */
const STATUS_LABEL = ORDER_STATUS_LABELS;

/**
 * Status komisi, diterjemahkan.
 *
 * Nilai di database tetap bahasa Inggris karena dibaca constraint dan
 * dipakai logika pencairan. Yang diterjemahkan hanya yang ditampilkan.
 */
/*
 * Fee layanan merchant pada satu baris transaksi.
 *
 * Nilai ini datang dari PostgREST sebagai number, string, atau null
 * tergantung kolomnya. `Number(null)` adalah 0 dan `Number("")` adalah 0,
 * jadi konversi aman - tapi tetap ditulis eksplisit supaya nilainya
 * tidak ikut berubah kalau bentuk kolomnya nanti berbeda.
 */
const numFee = (value: number | string | null) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Pilihan periode untuk kedua laporan.
 *
 * Satu daftar untuk Arus Kas dan Transaksi. Kalau masing-masing punya daftar
 * sendiri, Adding one preset to one report and forgetting the other will
 * create a silent difference.
 */
const REPORT_PRESET_OPTIONS = [
  { value: "7", label: "7 hari" },
  { value: "30", label: "30 hari" },
  { value: "90", label: "90 hari" },
] as const;

/**
 * Baris per halaman untuk tabel "Catatan kas harian".
 *
 * 14 dipilih karena satu halaman jadi muat di layar laptop tanpa scroll
 * dan tombol paginasi masih terlihat - kalau 30, operator harus menggulir
 * ke bawah hanya untuk menemukan tombol "Berikutnya", lalu menggulir lagi
 * untuk kembali ke tabel. Tabel dengan paginasi yang tersembunyi di bawah
 * lipatan adalah paginasi yang tidak dipakai.
 */
const CASH_DAYS_PER_PAGE = 14;

/**
 * Baris pengguna per halaman.
 *
 * 25, bukan 100. Seratus baris sekaligus terlihat cukup sampai daftar ini
 * melewati angka itu - lalu user ke-101 dan seterusnya hilang tanpa jalan
 * apa pun untuk ditemukan. Yang lebih pendek lebih enak dibaca, dan
 * pencarian menutup sisanya.
 */
const USERS_PER_PAGE = 25;

const COMMISSION_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  available: "Siap dicairkan",
  withdrawn: "Sudah dicairkan",
  cancelled: "Batal",
};

/**
 * Status pengiriman receipt, diterjemahkan.
 *
 * Nilai di database tetap bahasa Inggris (`pending`, `sending`, `sent`,
 * `failed`) karena itu yang dipakai constraint di migrasi 011 dan yang
 * dibaca cron. Yang diterjemahkan hanya yang DITAMPILKAN - mengubah nilai
 * di database akan membuat cron tidak mengenali statusnya.
 */
const RECEIPT_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  sending: "Mengirim",
  sent: "Terkirim",
  failed: "Gagal",
};

type CatalogSyncSummaryResult = {
  catalogItems: number;
  catalogSource: "live" | "cache";
  catalogScanAt: string;
  staleWarning: string | null;
  productsCreated: number;
  mappingsCreated: number;
  costsRefreshed: number;
  pricesRaised: number;
  deactivatedMissingSku: number;
  productsRemoved: number;
  productsHidden: number;
  gamesActivated: number;
  failures: string[];
};

type ActionStatus = "idle" | "running" | "ok" | "error";

type ActionState = {
  status: ActionStatus;
  /** Pesan singkat hasil terakhir, ditampilkan di bawah tombol. */
  message: string;
  /** Waktu hasil terakhir, supaya admin tahu ini data lama atau baru. */
  at: string | null;
};

const ACTION_STATE: Record<ActionStatus, string> = {
  idle: "",
  running: "⏳ ",
  ok: "✓ ",
  error: "! ",
};

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Label tanggal untuk baris harian arus kas.
 *
 * Bucket harian memakai kunci `YYYY-MM-DD` hasil `toISOString()` di server,
 * jadi string itu sudah MEWAKILI tengah malam UTC - bukan jam dinding.
 * `new Date("2026-10-14")` akan mem-parse-nya sebagai tengah malam
 * LOKAL, dan di server yang timezone-nya bukan UTC tanggalnya bisa geser
 * sehari. Karena itu offset nol ditulis secara eksplisit, lalu diformat
 * dengan `timeZone: UTC` supaya hasilnya tidak ikut timezone browser
 * operator.
 */
function formatWibDayLabel(dayKey: string) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dayKey;

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Tombol aksi supplier dengan status sendiri: spinner saat berjalan, lalu hasil
 * terakhir (sukses/gagal) beserta waktunya. Tanpa ini admin tidak bisa tahu
 * tombol mana yang sedang diproses atau hasil terakhirnya apa.
 */
function SupplierActionButton({
  action,
  label,
  busyLabel,
  busy,
  state,
  onClick,
}: {
  action: string;
  label: string;
  busyLabel: string;
  busy: string;
  state?: ActionState;
  onClick: () => void;
}) {
  const status = state?.status ?? "idle";
  const running = status === "running";

  return (
    <div className={`acc-action acc-action-${status}`} data-action={action}>
      <button
        type="button"
        onClick={onClick}
        disabled={Boolean(busy)}
        aria-busy={running || undefined}
      >
        {running ? busyLabel : label}
      </button>
      <span className="acc-action-status" role="status">
        {state?.message ? (
          <>
            <b aria-hidden="true">{ACTION_STATE[status]}</b>
            {state.message}
            {state.at ? <em>{formatTime(state.at)}</em> : null}
          </>
        ) : null}
      </span>
    </div>
  );
}

function numberOrDash(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

function draftFromProduct(product: CatalogProduct): DraftProduct {
  return {
    label: product.label,
    note: product.note ?? "",
    sellingPrice: String(product.sellingPrice),
    referencePrice: String(product.referencePrice),
    active: product.active,
    supplierSku: product.supplier.sku ?? "",
    internalSku: product.internalSku ?? "",
    /*
     * Mapping Melostore tidak ikut dimuat di draft: sumbernya endpoint
     * pemetaan yang berbeda, dan draft ini sudah dibaca `isDraftDirty`
     * untuk tombol "simpan semua". Mencampur keduanya membuat perubahan
     * harga dianggap perubahan mapping - dua hal yang berbeda risikonya.
     *
     * Dropdown Melostore menyimpan pilihannya di state terpisah dan
     * menyimpan lewat endpoint pemetaannya sendiri, tepat setelah
     * operator memilih.
     */
    melostoreSku: "",
  };
}

function roundTo100(value: number) {
  return Math.max(0, Math.round(value / 100) * 100);
}

function isDraftDirty(product: CatalogProduct, draft: DraftProduct) {
  return (
    draft.label !== product.label ||
    draft.note !== (product.note ?? "") ||
    Number(draft.sellingPrice) !== product.sellingPrice ||
    Number(draft.referencePrice) !== product.referencePrice ||
    draft.active !== product.active ||
    draft.supplierSku.trim() !== (product.supplier.sku ?? "") ||
    draft.internalSku.trim() !== (product.internalSku ?? "")
  );
}

function marginDariModal(
  cost: number | null,
  sellingPrice: number,
): { margin: number; percent: number } | null {
  if (cost === null || !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return null;
  }
  const margin = sellingPrice - cost;
  const percent = cost > 0 ? (margin / cost) * 100 : 0;
  return { margin, percent };
}

function marginOf(product: CatalogProduct, sellingPrice: number) {
  /*
   * Dasar margin = modal termurah antar supplier yang terpetakan.
   * Checkout memilih supplier termurah, jadi margin yang dibaca operator
   * harus dihitung terhadap supplier yang sama - kalau Melostore lebih
   * murah dan tetap dihitung dari Digiflazz, margin yang terlihat lebih
   * besar dari yang benar-benar diperoleh.
   */
  const kandidat = [product.supplier.cost, product.melostore.cost].filter(
    (cost): cost is number =>
      cost !== null && Number.isFinite(cost) && cost > 0,
  );
  return marginDariModal(
    kandidat.length > 0 ? Math.min(...kandidat) : null,
    sellingPrice,
  );
}

function SectionHead({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="acc-section-head">
      <div>
        <span className="acc-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Grafik batang omzet harian.
 *
 * SVG inline, bukan chart library. Alasannya ukuran: satu seri, satu sumbu,
 * dan{max 90} bar yang datanya sudah dihitung di server. Chart library
 * menambah ratusan kilobyte ke halaman admin untuk sesuatu yang bisa
 * dirender sebagai daftar `<rect>`.
 *
 * SUMBUNYA TIDAK DIMULAI DARI NOL saat semua hari kosong - kalau tidak,
 * chart akan menampilkan batang raksasa yang sebenarnya tidak ada, dan
 * terbaca sebagai ada omzet. Kasus itu ditandai eksplisit lewat
 * `acc-empty`.
 */
function CashFlowChart({
  days,
  profit,
}: {
  days: CashFlowPayload["days"];
  profit: number;
}) {
  if (days.length === 0) {
    return <div className="acc-empty">Belum ada data pada periode ini.</div>;
  }

  const hasRevenue = days.some((day) => day.grossRevenue > 0);
  if (!hasRevenue) {
    return (
      <div className="acc-empty">
        Belum ada penjualan selesai pada periode ini. Order yang gagal atau
        masih diproses tidak dihitung sebagai omzet.
      </div>
    );
  }

  const max = Math.max(...days.map((day) => day.grossRevenue), 1);
  // 90 hari pada lebar penuh ~= 4px per batang. Di bawah itu batang
  // mulai saling tumpang tindih dan grafik jadi noise.
  const barGap = days.length > 60 ? 1 : days.length > 30 ? 2 : 4;
  const chartHeight = 150;

  return (
    <div className="acc-chart">
      <div className="acc-chart-bars" style={{ gap: `${barGap}px` }}>
        {days.map((day) => {
          const height = Math.max(
            day.grossRevenue > 0 ? 3 : 1,
            Math.round((day.grossRevenue / max) * chartHeight),
          );
          const label = `${day.date}: ${formatIDR(day.grossRevenue)} dari ${day.orders} pesanan`;
          return (
            <span
              key={day.date}
              className={
                day.grossRevenue > 0 ? "acc-chart-bar" : "acc-chart-bar empty"
              }
              style={{ height: `${height}px` }}
              title={label}
              aria-label={label}
              role="img"
            />
          );
        })}
      </div>
      <div className="acc-chart-axis">
        <span>{days[0]?.date.slice(5)}</span>
        <span>
          puncak {formatIDR(max)} · margin total {formatIDR(profit)}
        </span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function RoadmapCard({
  title,
  status,
  copy,
}: {
  title: string;
  status: "live" | "foundation" | "planned";
  copy: string;
}) {
  return (
    <article className="acc-roadmap-card">
      <div>
        <strong>{title}</strong>
        <span className={`acc-roadmap-status ${status}`}>
          {status === "live"
            ? "Jalan"
            : status === "foundation"
              ? "Pondasi"
              : "Direncanakan"}
        </span>
      </div>
      <p>{copy}</p>
    </article>
  );
}

export default function AdminDashboard() {
  const [authState, setAuthState] = useState<
    "loading" | "guest" | "forbidden" | "ready"
  >("loading");

  /*
   * Section aktif TIDAK lagi punya state sendiri di komponen ini.
   *
   * Dulu `const [section, setSection] = useState(...)` ada di sini dan
   * salinannya diteruskan ke sidebar lewat konteks. Dua efek bridging
   * menjaga kedua salinan itu tetap sama: satu push dari dashboard ke
   * konteks, satu pull dari konteks ke dashboard. Begitu keduanya beda
   * sesaat - yang pasti terjadi saat dashboard mount dengan sisa
   * section dari kunjungan sebelumnya - keduanya saling menimpa dalam
   * render berulang tanpa akhir, dan React melaporkan
   * "Maximum update depth exceeded".
   *
   * Sekarang konteks jadi satu-satunya tempat section hidup. Dashboard
   * membacanya, sidebar membacanya, dan keduanya menulis lewat
   * `setSection` yang sama. Tidak ada lagi yang bisa tidak sinkron karena
   * hanya ada satu nilai.
   */
  const { section: activeSection, setSection, role: contextRole, setRole } =
    useAdminSection();
  const section: AdminSection = activeSection ?? "overview";

  /*
   * Deep-link dari halaman dokumentasi: `/admin?seksi=merchants`.
   *
   * Tanpa ini, tombol "Buka halaman ini" di docs akan mendarat di
   * Ringkasan karena section selalu mulai dari overview - dan operator
   * mengira docs-nya salah.
   *
   * Query TIDAK dihapus dari URL setelah dibaca. Membiarkannya membuat
   * section bisa di-bookmark dan dibagikan, dan menyegarkan halaman
   * tidak lagi melempar operator ke Ringkasan.
   *
   * Syaratnya `activeSection !== null`, bukan penanda "sudah jalan".
   * Itu bedanya aman dan tidak aman: konteks DIKOSONGKAN saat dashboard
   * turun, jadi "masih kosong" otomatis berarti "dashboard baru mount".
   * Penanda boolean akan bertahan lintas mount dan membuat deep-link
   * berikutnya diabaikan begitu operator pernah membuka dashboard
   * sekali saja. Jotak "kosong" ini juga idempoten di StrictMode, yang
   * menjalankan efek dua kali - penanda boolean akan membuat hasil dua
   * run itu berbeda.
   */
  useEffect(() => {
    if (activeSection !== null) return;
    if (!contextRole) return;

    const requested = new URLSearchParams(window.location.search).get(
      "seksi",
    );
    const match = requested
      ? NAV.find((item) => item.id === requested)
      : undefined;

    /*
     * Section awal harus section yang BOLEH dibuka.
     *
     * Tanpa pemeriksaan ini, admin yang mendapat tautan `?seksi=users`
     * akan mendarat di section yang endpointnya menolak - operator melihat
     * error 403 tanpa penjelasan. Menolak deep-link yang tidak diizinkan
     * lebih baik daripada memuat halaman yang pasti gagal.
     */
    const sectionAllowed = (id: string) =>
      canAccessScope(contextRole, SECTION_SCOPE[id] ?? "sistem");

    const pilihan =
      match && sectionAllowed(match.id)
        ? match.id
        : firstAllowedSection(
            contextRole,
            NAV.map((item) => item.id),
            (id) => SECTION_SCOPE[id] ?? "sistem",
          );

    // Tanpa query yang cocok, tetap diisi supaya tidak ada render
    // pertama tanpa section.
    if (pilihan) setSection(pilihan);
  }, [activeSection, setSection, contextRole]);

  /*
   * Saat dashboard tidak ada di layar, tidak boleh ada section yang
   * terlihat aktif di sidebar.
   *
   * Tanpa ini, `/admin/docs` akan tetap menyorot butir section yang
   * terakhir dibuka - dan karena grup yang memegang section aktif tidak
   * boleh terlipat, satu grup pun tidak bisa ditutup selama operator
   * berada di halaman mana pun selain dashboard.
   *
   * Efek ini HANYA membersihkan. Ia tidak pernah menulis section lain,
   * lain, jadi tidak mungkin bertabrakan dengan efek di atas.
   */
  useEffect(() => () => setSection(null), []);
  const [adminUser, setAdminUser] = useState<AdminSessionUser | null>(null);
  const [adminRole, setAdminRoleState] = useState("");
  /*
   * Role hanya bisa diketahui setelah session terbaca, tapi sidebar sudah
   * ter-render lebih dulu - jadi dashboard yang memublikasikannya ke
   * konteks. Sidebar membaca dari sana, tidak pernah menebaknya sendiri.
   */
  const setAdminRole = useCallback(
    (next: string) => {
      setAdminRoleState(next);
      setRole(next);
    },
    [setRole],
  );
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [pointsData, setPointsData] = useState<AdminPointsPayload | null>(null);
  const [affiliateData, setAffiliateData] = useState<AffiliatePayload | null>(null);
  const [promotionData, setPromotionData] = useState<PromotionPayload | null>(null);
  const [orderDetail, setOrderDetail] = useState<AdminOrderDetail | null>(null);
  const [usersData, setUsersData] = useState<AdminUsersPayload | null>(null);
  /*
   * Halaman tabel pengguna.
   *
   * 25 baris per halaman, bukan "tampilkan 100 lalu berhenti". Versi lama
   * memakai `slice(0, 100)` tanpa pencarian, tanpa paginasi, dan tanpa
   * jumlah total - jadi user ke-101 dan seterusnya tidak punya jalan
   * apa pun untuk ditemukan, dan operator tidak punya alasan untuk menduga
   * bahwa mereka ada.
   */
  const [usersPage, setUsersPage] = useState(0);
  const [usersQuery, setUsersQuery] = useState("");
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountsPayload | null>(null);
  /*
   * Role tujuan untuk setiap baris customer yang akan dipromote.
   *
   * Disimpan per userId, bukan sebagai satu state global, supaya pilihan di
   * satu baris tidak ikut berubah ketika baris lain dipakai. Dengan satu
   * state global, operator yang menyiapkan tiga akun sekaligus akan selalu
   * promotes semuanya dengan role terakhir yang dipilih.
   */
  const [promoteRole, setPromoteRole] = useState<Record<string, "admin" | "superadmin">>({});
  const [financeData, setFinanceData] = useState<FinancePayload | null>(null);
  const [cashFlowData, setCashFlowData] = useState<CashFlowPayload | null>(null);
  /** Halaman tabel "Catatan kas harian". */
  const [cashFlowDayPage, setCashFlowDayPage] = useState(0);
  /*
   * Periode laporan arus kas.
   *
   * Default "30" bukan "7": sebagian besar toko ritel baru jalan kurang
   * dari sebulan, jadi laporan 7 hari hampir selalu kosong dan terlihat
   * seperti fiturnya rusak. Tiga puluh hari juga cukup untuk melihat pola
   * mingguan.
   */
  /*
   * Periode aktif. `preset` kosong berarti sedang memakai rentang
   * tanggal yang diketik operator, bukan preset.
   */
  const [cashFlowRange, setCashFlowRange] = useState<ReportRangeValue>({
    preset: "30",
    from: "",
    to: "",
  });

  /*
   * Filter laporan transaksi.
   *
   * Semua filter disimpan sebagai state terpisah, bukan satu objek
   * JSON, supaya reset per-field (mis. hanya mengosongkan pencarian)
   * tidak memicu fetch ulang yang tidak perlu.
   */
  const [txRange, setTxRange] = useState<ReportRangeValue>({
    preset: "30",
    from: "",
    to: "",
  });
  const [txQuery, setTxQuery] = useState("");
  const [txStatus, setTxStatus] = useState("");
  const [txPayment, setTxPayment] = useState("");
  const [txOffset, setTxOffset] = useState(0);
  const [txReport, setTxReport] = useState<TransactionReportPayload | null>(
    null,
  );
  /*
   * Nilai pencarian yang benar-benar dipakai saat fetch. Admin mengetik
   * cepat, jadi input dan query dipisah: input berubah tiap ketukan,
   * query baru dipakai setelah operator menekan Enter atau tombol Cari.
   *
   * Kalau pencarian ikut berubah tiap ketukan, setiap huruf memicu satu
   * query ke database.
   */
  const [txAppliedQuery, setTxAppliedQuery] = useState("");
  const [merchantData, setMerchantData] = useState<MerchantsPayload | null>(null);
  const [merchantForm, setMerchantForm] = useState<MerchantForm | null>(null);
  const [merchantPaymentForm, setMerchantPaymentForm] =
    useState<MerchantPaymentForm | null>(null);

  const [issuedPin, setIssuedPin] = useState<{
    code: string;
    pin: string;
    notice: string;
  } | null>(null);
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [promoDraft, setPromoDraft] = useState({
    code: "",
    name: "",
    type: "flat" as "flat" | "percentage",
    value: "1000",
    minimumOrder: "20000",
    maxDiscount: "",
    quota: "",
    quotaPerUser: "1",
    startsAt: "",
    endsAt: "",
  });
  const [drafts, setDrafts] = useState<Record<string, DraftProduct>>({});
  /*
   * Kandidat SKU dari kedua supplier, dibaca sekali saat section Katalog
   * dibuka.
   *
   * Sumbernya supplier_catalog_items lewat endpoint pemetaan - bukan API
   * supplier. Katalog Melostore berisi 10.000 SKU dengan tarif 20
   * permintaan/menit; menarik setiap kali form dibuka akan menghabiskan
   * jatah itu dan membuat dropdown selalu gagal di jam sibuk.
   */
  const [supplierCatalog, setSupplierCatalog] = useState<{
    digiflazz: Array<{ sku: string; name: string; cost: number }>;
    melostore: Array<{
      sku: string;
      name: string;
      cost: number;
      brand: string | null;
    }>;
    error: string | null;
  }>({ digiflazz: [], melostore: [], error: null });
  const [melostorePick, setMelostorePick] = useState<Record<string, string>>({});
  const [melostoreBusy, setMelostoreBusy] = useState("");
  /*
   * Katalog produk dirender 25 baris per halaman. Versi lama merender
   * ribuan baris form sekaligus - halaman menggantung sebelum tombol
   * pertama bisa diklik.
   */
  const [katalogPage, setKatalogPage] = useState(1);
  /* Pilihan Melostore yang BENAR-BENAR TERSIMPAN, pembeda dari draf. */
  const [melostoreTersimpan, setMelostoreTersimpan] = useState<
    Record<string, string | null>
  >({});
  const [melostoreCari, setMelostoreCari] = useState<Record<string, string>>({});
  const [melostoreTerbuka, setMelostoreTerbuka] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [marginFilter, setMarginFilter] = useState("all");
  const [bulkPercent, setBulkPercent] = useState("5");
  const [suggestPercent, setSuggestPercent] = useState("5");
  const [suggestRefPercent, setSuggestRefPercent] = useState("10");
  const [compareOpenId, setCompareOpenId] = useState<string | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const confirm = useConfirm();

  function hydrateDrafts(payload: CatalogPayload) {
    setDrafts(
      Object.fromEntries(
        payload.products.map((product) => [
          product.id,
          draftFromProduct(product),
        ]),
      ),
    );
  }

  async function loadOverview() {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("guest");
      return;
    }
    const data = (await response.json()) as OverviewPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Overview admin gagal dimuat.");
    }
    setOverview(data);
  }

  async function loadCatalog() {
    const response = await fetch("/api/admin/catalog", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("guest");
      return;
    }
    const data = (await response.json()) as CatalogPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Katalog admin gagal dimuat.");
    }
    setCatalog(data);
    hydrateDrafts(data);
  }

  async function loadOrders() {
    const response = await fetch("/api/admin/orders", { cache: "no-store" });
    const data = (await response.json()) as {
      orders?: AdminOrder[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Order gagal dimuat.");
    setOrders(data.orders ?? []);
  }

  async function loadReceipts() {
    const response = await fetch("/api/admin/receipts", { cache: "no-store" });
    const data = (await response.json()) as {
      receipts?: ReceiptRow[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Receipt gagal dimuat.");
    setReceipts(data.receipts ?? []);
  }

  async function loadPoints() {
    const response = await fetch("/api/admin/points", { cache: "no-store" });
    const data = (await response.json()) as AdminPointsPayload & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Lacte Points gagal dimuat.");
    }
    setPointsData(data);
  }

  async function runPointsExpiry() {
    setBusy("points-expiry");
    setNotice("");
    try {
      const response = await fetch("/api/admin/points/expire", {
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        lotsProcessed?: number;
        pointsExpired?: number;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Expiry Lacte Points gagal.");
      }
      await loadPoints();
      setNotice(
        `Points expiry selesai: ${data.pointsExpired ?? 0} pts expired dari ${data.lotsProcessed ?? 0} lot.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Expiry Lacte Points gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadAffiliates() {
    const response = await fetch("/api/admin/affiliates", { cache: "no-store" });
    const data = (await response.json()) as AffiliatePayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Affiliate ledger gagal dimuat.");
    }
    setAffiliateData(data);
  }

  async function loadPromotions() {
    const response = await fetch("/api/admin/promotions", { cache: "no-store" });
    const data = (await response.json()) as PromotionPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Promo gagal dimuat.");
    setPromotionData(data);
  }

  async function createPromotion() {
    setBusy("promotion-create");
    setNotice("");
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoDraft.code,
          name: promoDraft.name,
          type: promoDraft.type,
          value: Number(promoDraft.value),
          minimumOrder: Number(promoDraft.minimumOrder),
          maxDiscount: promoDraft.maxDiscount || null,
          quota: promoDraft.quota || null,
          quotaPerUser: promoDraft.quotaPerUser || null,
          startsAt: promoDraft.startsAt
            ? new Date(promoDraft.startsAt).toISOString()
            : null,
          endsAt: promoDraft.endsAt
            ? new Date(promoDraft.endsAt).toISOString()
            : null,
          active: true,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Promo gagal dibuat.");
      setPromoDraft({
        code: "",
        name: "",
        type: "flat",
        value: "1000",
        minimumOrder: "20000",
        maxDiscount: "",
        quota: "",
        quotaPerUser: "1",
        startsAt: "",
        endsAt: "",
      });
      await Promise.all([loadPromotions(), loadOverview()]);
      setNotice("Promo berhasil dibuat.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promo gagal dibuat.");
    } finally {
      setBusy("");
    }
  }

  async function togglePromotion(code: string, active: boolean) {
    setBusy("promotion:" + code);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, active }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Promo gagal diperbarui.");
      await Promise.all([loadPromotions(), loadOverview()]);
      setNotice(code + (active ? " diaktifkan." : " dinonaktifkan."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promo gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  async function deletePromotion(code: string) {
    const confirmed = await confirm({
      title: `Hapus promo ${code}?`,
      description:
        "Promo hanya bisa dihapus bila belum pernah dipakai. Tindakan ini tidak bisa dibatalkan.",
      tone: "danger",
      confirmLabel: "Hapus promo",
    });
    if (!confirmed) return;

    setBusy("promotion-delete:" + code);
    try {
      const response = await fetch(
        "/api/admin/promotions?code=" + encodeURIComponent(code),
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Promo gagal dihapus.");
      await Promise.all([loadPromotions(), loadOverview()]);
      setNotice(`Promo ${code} berhasil dihapus.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promo gagal dihapus.");
    } finally {
      setBusy("");
    }
  }

  async function inspectOrder(orderId: string) {
    setBusy("inspect:" + orderId);
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/orders/" + encodeURIComponent(orderId),
        { cache: "no-store" },
      );
      const data = (await response.json()) as AdminOrderDetail & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Detail order gagal dimuat.");
      }
      setOrderDetail(data);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Detail order gagal dimuat.",
      );
    } finally {
      setBusy("");
    }
  }

  async function retryAdminReceipt(orderId: string) {
    setBusy("receipt:" + orderId);
    setNotice("");
    try {
      const response = await fetch(
        "/api/admin/orders/" + encodeURIComponent(orderId) + "/receipt",
        { method: "POST" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Receipt gagal dikirim ulang.");
      }
      await inspectOrder(orderId);
      setNotice("Receipt diproses ulang.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Receipt gagal dikirim ulang.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = (await response.json()) as AdminUsersPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Data user gagal dimuat.");
    setUsersData(data);
  }

  /*
   * Pencarian pengguna.
   *
   * Dicocokkan di sisi klien karena seluruh daftar sudah termuat di memori.
   * Kalau nanti daftar ini tumbuh jadi ribuan baris, pencarian pindah ke
   * server. Memindahkannya sekarang hanya menambah satu request per
   * ketikan tanpa memperbaiki apa pun.
   *
   * `toLowerCase` dipakai di KEDUA sisi. Tanpa itu, pencarian "Elin" tidak
   * akan menemukan "elinapromedia@gmail.com" hanya karena huruf besarnya
   * berbeda - dan itu bentuk kegagalan yang paling mudah disalahkan ke
   * orang yang keliru.
   */
  const normalizedUsersQuery = usersQuery.trim().toLowerCase();

  const filteredUsers = (usersData?.users ?? []).filter((item) => {
    if (!normalizedUsersQuery) return true;

    return [
      item.displayName,
      item.email,
      item.whatsapp,
      item.userId,
    ].some((field) =>
      (field ?? "").toLowerCase().includes(normalizedUsersQuery),
    );
  });

  const usersPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const safeUsersPage = Math.min(usersPage, usersPageCount - 1);
  const visibleUsers = filteredUsers.slice(
    safeUsersPage * USERS_PER_PAGE,
    (safeUsersPage + 1) * USERS_PER_PAGE,
  );

  /**
   * Daftar akun admin.
   *
   * Route-nya superadminOnly, jadi kegagalan 403 di sini itu jawaban yang
   * benar - bukan error. Daftar dikosongkan supaya UI tidak menampilkan
   * "gagal dimuat" untuk operator yang memang tidak berhak melihatnya.
   */
  async function loadAdminAccounts() {
    const response = await fetch("/api/admin/admin-users", { cache: "no-store" });
    if (response.status === 403) {
      setAdminAccounts(null);
      return;
    }
    const data = (await response.json()) as AdminAccountsPayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Daftar admin gagal dimuat.");
    setAdminAccounts(data);
  }

  async function changeAdminAccess(input: {
    userId: string;
    role: "admin" | "superadmin";
    active: boolean;
  }) {
    setBusy(`admin-access:${input.userId}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/admin-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: input.userId,
          role: input.role,
          active: input.active,
        }),
      });
      const data = (await response.json()) as { error?: string; changed?: boolean };
      if (!response.ok) {
        throw new Error(data.error ?? "Perubahan akses gagal.");
      }

      /*
       * Pesan sukses selalu menyebut langkah berikutnya. Menonaktifkan akses
       * tidak langsung mengeluarkan orang dari dashboard: cookie-nya masih
       * hidup sampai dua jam. Tanpa kalimat ini, operator akan melihat
       * orang yang sudah dinonaktifkan masih masuk, lalu menganggap
       * fiturnya tidak bekerja.
       */
      const target = adminAccounts?.admins.find((item) => item.userId === input.userId);
      setNotice(
        input.active
          ? `Akses admin diberikan sebagai ${input.role === "superadmin" ? "superadmin" : "admin"}. Akun harus login ulang sebelum dashboard terbuka.`
          : `Akses admin dicabut dari ${target?.email ?? target?.displayName ?? "akun tersebut"}. Sesi yang sedang berjalan tetap berlaku sampai cookie habis - sekitar 2 jam.`,
      );

      await Promise.all([loadAdminAccounts(), loadUsers()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Perubahan akses gagal.");
    } finally {
      setBusy("");
    }
  }

  async function loadFinance() {
    const response = await fetch("/api/admin/finance", { cache: "no-store" });
    const data = (await response.json()) as FinancePayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Financial reconciliation gagal dimuat.");
    }
    setFinanceData(data);
  }

  async function loadCashFlow(range: ReportRangeValue = cashFlowRange) {
    /*
     * Preset DAN rentang bebas dikirim. Server memutuskan: kalau `from`
     * dan `to` keduanya ada dan valid, preset diabaikan. Mengirim
     * keduanya membuat satu endpoint melayani dua cara tanpa perlu
     * cabang di sisi klien.
     */
    const params = new URLSearchParams();
    if (range.preset) params.set("preset", range.preset);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);

    const response = await fetch(`/api/admin/cash-flow?${params.toString()}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as CashFlowPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Laporan arus kas gagal dimuat.");
    }
    setCashFlowData(data);
    /*
     * Halaman tabel kas harian dikembalikan ke awal setiap rentang baru
     * dimuat.
     *
     * Tanpa ini, membuka "90 hari" lalu menyaring sampai halaman 4, lalu
     * beralih ke "7 hari", membuat operator melihat tabel kosong - bukan
     * karena periode itu sepi, tapi karena halaman 4 tidak ada di sana.
     */
    setCashFlowDayPage(0);
  }

  /**
   * Unduh laporan sebagai CSV.
   *
   * Fetch lalu dibuat blob, bukan langsung `<a href>` ke endpoint. Alasannya
   * endpoint CSV memakai header `Content-Disposition`, dan navigasi langsung
   * akan mengunduh file tanpa memberi umpan balik apa pun ke operator -
   * tombolnya terlihat seperti tidak merespons.
   */
  async function downloadCashFlowCsv() {
    setBusy("cashflow-csv");
    try {
      /*
       * Rentang yang sama persis dengan yang sedang tampil.
       * Dulu hanya preset yang terkirim, jadi mengunduh rentang bebas
       * akan menghasilkan CSV 30 hari terakhir - file yang periodenya
       * berbeda dari yang ada di layar, dan itu penyebab paling umum
       * orang salah menyimpulkan dari laporan.
       */
      const params = new URLSearchParams({ format: "csv" });
      if (cashFlowRange.preset) params.set("preset", cashFlowRange.preset);
      if (cashFlowRange.from) params.set("from", cashFlowRange.from);
      if (cashFlowRange.to) params.set("to", cashFlowRange.to);

      const response = await fetch(`/api/admin/cash-flow?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unduh CSV gagal.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const stamp = cashFlowData
        ? `${cashFlowData.from.slice(0, 10)}_${cashFlowData.to.slice(0, 10)}`
        : "arus-kas";
      const link = document.createElement("a");
      link.href = url;
      link.download = `arus-kas_${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Object URL harus dicabut; tanpa ini blob-nya tertahan di memori
      // sampai halaman ditutup.
      URL.revokeObjectURL(url);
      setNotice("CSV arus kas sudah diunduh.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unduh CSV gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  /**
   * Susun query string laporan transaksi dari filter saat ini.
   *
   * Diekstrak jadi satu fungsi karena dipakai oleh dua tempat: pemuatan
   * tampilan dan unduh CSV. Kalau keduanya menyusun query sendiri, cepat
   * atau lambat operator bisa mengunduh CSV yang berbeda dari yang
   * sedang tampil di layar - dan itu kesalahan yang tidak akan pernah
   * ketahuan karena keduanya terlihat berfungsi.
   */
  function buildTransactionQuery(
    extra?: Record<string, string>,
    rangeArg: ReportRangeValue = txRange,
  ) {
    /*
     * Range-nya dikirim sebagai parameter, bukan dibaca dari state.
     *
     * Dulu `buildTransactionQuery` membaca `txRange` langsung dari
     * closure. Setelah `setTxRange(next)` dipanggil, `txRange` di
     * closure itu masih nilai LAMA sampai komponen render ulang - jadi
     * `loadTransactions()` yang langsung dipanggil sesudahnya mengirim
     * periode yang lama, bukan yang baru dipilih.
     *
     * Gejalanya menipu: tombol preset berubah menyala, dan tabelnya
     * masih menampilkan periode sebelumnya. Tidak ada error, tidak ada
     * loading yang menggantung. Operator mengira rentangnya terpakai
     * padahal tidak.
     *
     * Arus kas sudah benar sejak awal - `loadCashFlow(next)` meneruskan
     * range secara eksplisit. Transaksi sekarang mengikuti pola yang
     * sama.
     */
    const params = new URLSearchParams();
    const range = rangeArg;

    if (range.preset) params.set("preset", range.preset);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (txAppliedQuery.trim()) params.set("q", txAppliedQuery.trim());
    if (txStatus) params.set("status", txStatus);
    if (txPayment) params.set("payment", txPayment);
    for (const [key, value] of Object.entries(extra ?? {})) {
      params.set(key, value);
    }
    return params.toString();
  }

  async function loadTransactions(
    override?: { offset?: number },
    rangeArg: ReportRangeValue = txRange,
  ) {
    const query = buildTransactionQuery(
      { offset: String(override?.offset ?? txOffset) },
      rangeArg,
    );
    const response = await fetch(`/api/admin/transactions?${query}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as TransactionReportPayload & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Laporan transaksi gagal dimuat.");
    }
    setTxReport(data);
  }

  async function downloadTransactionsCsv() {
    setBusy("tx-csv");
    try {
      const response = await fetch(
        `/api/admin/transactions?${buildTransactionQuery({ format: "csv" })}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error("Unduh CSV gagal.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      /*
 * Nama file memakai periode dari state, bukan dari `txReport`.
 *
 * `txReport.from` dan `.to` adalah timestamp UTC dari server. Di GMT+7,
 * rentang yang dimulai 1 Januari pukul 00:00 waktu lokal berarti
 * 31 Desember 17:00 UTC - jadi `slice(0, 10)` menulis "2025-12-31" ke
 * nama file, padahal yang ditampilkan di layar adalah 1 Januari.
 *
 * Konsekuensinya: operator mengunduh `transaksi_2025-12-31_2026-01-30.csv`
 * untuk laporan yang isinya 1-30 Januari, lalu membukanya weeks kemudian
 * dan menyimpang satu hari saat membandingkan denganMutu lain.
 *
 * `txRange` juga sudah benar di sini karena unduhan CSV adalah aksi
 * eksplisit: yang sedang diklik memang periode yang ada di layar.
 */
const txDataStamp = txRange.preset
        ? `${txRange.preset}hari`
        : txRange.from && txRange.to
          ? `${txRange.from}_${txRange.to}`
          : "transaksi";
      link.download = `transaksi_${txDataStamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Tanpa revoke, blob-nya tertahan di memori sampai tab ditutup.
      URL.revokeObjectURL(url);
      setNotice("CSV transaksi sudah diunduh (semua baris terfilter).");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unduh CSV gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadMerchants() {
    const response = await fetch("/api/admin/merchants", { cache: "no-store" });
    const data = (await response.json()) as MerchantsPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Data toko ritel gagal dimuat.");
    }
    setMerchantData(data);
    setMerchantForm(null);
  }

  async function createMerchant() {
    if (!merchantForm?.name.trim() || !merchantForm.code.trim()) {
      setNotice("Nama toko dan kode toko wajib diisi.");
      return;
    }
    setBusy("merchant-create");
    setNotice("");
    try {
      const response = await fetch("/api/admin/merchants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: merchantForm.name,
          code: merchantForm.code,
          serviceFeeFlatIdr: merchantForm.serviceFeeFlatIdr,
          paymentTermDays: merchantForm.paymentTermDays,
          notes: merchantForm.notes,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        pin?: string;
        pinNotice?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Gagal membuat toko.");
      }

      /*
       * PIN baru SEKALI ini ditampilkan, lalu langsung disembunyikan.
       * Menyimpan PIN di state setelah efek ini selesai hanya prolongasi
       * jendela di mana PIN terlihat di layar admin.
       */
      setIssuedPin({
        code: merchantForm.code.trim().toUpperCase(),
        pin: data.pin ?? "",
        notice: data.pinNotice ?? "",
      });
      await loadMerchants();
      setNotice("Toko dibuat. PIN kasir sudah ditampilkan di bawah.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gagal membuat toko.");
    } finally {
      setBusy("");
    }
  }

  async function updateMerchant() {
    if (!merchantForm?.id) return;
    setBusy("merchant-update");
    setNotice("");
    try {
      const response = await fetch("/api/admin/merchants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: merchantForm.id,
          serviceFeeFlatIdr: merchantForm.serviceFeeFlatIdr,
          paymentTermDays: merchantForm.paymentTermDays,
          status: merchantForm.status,
          notes: merchantForm.notes,
          resetPin: merchantForm.resetPin,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        pin?: string;
        pinNotice?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Gagal menyimpan toko.");
      }

      setIssuedPin(
        data.pin
          ? {
              code: merchantForm.code,
              pin: data.pin,
              notice: data.pinNotice ?? "",
            }
          : null,
      );
      await loadMerchants();
      setNotice(data.pin ? "PIN kasir diganti." : "Toko diperbarui.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Gagal menyimpan toko.",
      );
    } finally {
      setBusy("");
    }
  }

  /**
   * Catat pelunasan merchant.
   *
   * Allocation-nya FIFO dan terjadi di server - form ini tidak pernah
   * menentukan order mana yang lunas. Konsekuensinya, `credit` (sisa bayar)
   * harus ditampilkan: kalau transfer lebih besar dari piutang, admin perlu
   * tahu kelebihan itu tersimpan sebagai kredit, bukan hilang.
   */
  async function recordMerchantPayment() {
    if (!merchantPaymentForm?.merchantId) return;

    const amount = Number(merchantPaymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Nominal pelunasan harus lebih besar dari nol.");
      return;
    }

    setBusy("merchant-payment");
    setNotice("");
    try {
      const response = await fetch("/api/admin/merchant-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: merchantPaymentForm.merchantId,
          amount: merchantPaymentForm.amount,
          method: merchantPaymentForm.method,
          reference: merchantPaymentForm.reference,
          note: merchantPaymentForm.note,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        amount?: number;
        applied?: number;
        credit?: number;
        settledCount?: number;
        remainingOutstanding?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Gagal mencatat pelunasan.");
      }

      // Muat ulang daftar toko supaya kolom piutang langsung berubah
      // ke angka terbaru - kalau tidak, admin akan melihat angka lama dan
      // mengira pencatatan gagal padahal berhasil.
      await loadMerchants();

      const parts = [
        `${formatIDR(data.applied ?? 0)} dicatat dari ${formatIDR(data.amount ?? 0)}.`,
        `${data.settledCount ?? 0} tagihan lunas.`,
      ];
      if (data.credit && data.credit > 0) {
        parts.push(
          `Sisa bayar ${formatIDR(data.credit)} disimpan sebagai kredit toko.`,
        );
      }

      setNotice(parts.join(" "));
      setMerchantPaymentForm(null);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Gagal mencatat pelunasan.",
      );
    } finally {
      setBusy("");
    }
  }

  async function runFinanceReconciliation() {
    setBusy("finance-reconcile");
    setNotice("");
    try {
      const response = await fetch("/api/admin/finance", { method: "POST" });
      const data = (await response.json()) as {
        checked?: number;
        ok?: number;
        warning?: number;
        errors?: number;
        rows?: FinancePayload["rows"];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Financial reconciliation gagal.");
      }
      await loadFinance();
      setNotice(
        "Finance check selesai: " +
          (data.checked ?? 0) +
          " order · " +
          (data.errors ?? 0) +
          " error · " +
          (data.warning ?? 0) +
          " warning.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Financial reconciliation gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadReadiness() {
    const response = await fetch("/api/admin/readiness", { cache: "no-store" });
    const data = (await response.json()) as ReadinessPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Readiness check gagal dimuat.");
    }
    setReadiness(data);
  }

  async function runReconciliation() {
    setBusy("reconciliation");
    setNotice("");
    try {
      const response = await fetch("/api/admin/reconciliation", {
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        orders?: {
          checked: number;
          recovered: number;
          pending: number;
          failed: number;
        };
        supplier?: {
          checked: number;
          applied: number;
          stillPending: number;
          skipped: number;
          failed: number;
        };
        receipts?: {
          retried: number;
          sent: number;
          stillFailed: number;
          staleSending: number;
        };
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Reconciliation gagal.");
      }

      await Promise.all([loadOverview(), loadOrders(), loadReceipts()]);
      setNotice(
        `Reconciliation selesai: ${data.orders?.recovered ?? 0} order pulih, ${data.supplier?.applied ?? 0} status supplier diterapkan, ${data.receipts?.sent ?? 0} receipt terkirim ulang, ${data.receipts?.staleSending ?? 0} receipt sending perlu review.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Reconciliation gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  async function refreshCurrent() {
    setBusy("refresh");
    setNotice("");
    try {
      await loadOverview();
      if (section === "orders") await loadOrders();
      if (section === "catalog" || section === "supplier") {
        await loadCatalog();
        /*
         * Kandidat SKU dimuat bersama katalog, sekali per buka section.
         * Per-produk saat editor dibuka berarti satu permintaan per
         * baris - dan daftar SKU ini sama untuk semua produk.
         */
        await muatKandidatSupplier();
      }
      if (section === "receipts") await loadReceipts();
      if (section === "points") await loadPoints();
      if (section === "affiliates") await loadAffiliates();
      if (section === "promotions") await loadPromotions();
      if (section === "users") {
        await Promise.all([loadUsers(), loadAdminAccounts()]);
      }
      if (section === "finance") await loadFinance();
      if (section === "cashflow") await loadCashFlow();
      if (section === "transactions") await loadTransactions();
      if (section === "merchants") await loadMerchants();
      if (section === "system") await loadReadiness();
      setNotice("Data admin diperbarui.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Refresh admin gagal.",
      );
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          configured?: boolean;
          authenticated?: boolean;
          forbidden?: boolean;
          role?: string;
          user?: AdminSessionUser | null;
          error?: string;
        };
        if (!mounted) return;

        if (!response.ok || !data.configured) {
          setAuthState("guest");
          setNotice(data.error ?? "Admin session belum dikonfigurasi.");
          return;
        }

        if (data.forbidden) {
          setAdminUser(data.user ?? null);
          setAuthState("forbidden");
          return;
        }

        if (!data.authenticated) {
          setAuthState("guest");
          return;
        }

        setAdminUser(data.user ?? null);
        const role = data.role ?? "admin";
        setAdminRole(role);

        /*
         * Muat HANYA yang boleh diakses role ini.
         *
         * Versi lama selalu memanggil overview dan catalog. begitu role
         * dibatasi, panggilan itu berhenti dengan 403 - dan karena seluruh
         * pemuatan dibungkus satu try/catch, satu 403 menjatuhkan
         * `authState` ke "guest". Akibatnya admin melihat halaman login,
         * bukan dashboard-nya. Itu alias, bukan error.
         *
         * Kegagalan pemuatan data juga tidak boleh menjatuhkan seluruh
         * dashboard. Pola di bawah dipisah supaya satu endpoint yang
         * sedang bermasalah tidak menutup semua halaman.
         */
        const muatan = [loadOverview(), loadCatalog()].map((promise) =>
          promise.catch((error) => {
            console.error("Dashboard initial load failed", error);
            return null;
          }),
        );
        await Promise.all(muatan);

        if (mounted) setAuthState("ready");
      } catch (error) {
        if (mounted) {
          setAuthState("guest");
          setNotice(
            error instanceof Error
              ? error.message
              : "Dashboard admin belum dapat dihubungi.",
          );
        }
      }
    }

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;

    if (section === "orders" && orders.length === 0) {
      void loadOrders().catch((error) =>
        setNotice(error instanceof Error ? error.message : "Order gagal dimuat."),
      );
    }
    if (section === "receipts" && receipts.length === 0) {
      void loadReceipts().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Receipt gagal dimuat.",
        ),
      );
    }
    if (section === "points" && !pointsData) {
      void loadPoints().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Lacte Points gagal dimuat.",
        ),
      );
    }
    /*
     * Kandidat SKU Melostore dimuat saat seksi katalog dibuka, bukan hanya
     * saat tombol refresh ditekan. Combobox per baris membaca daftar ini;
     * tanpa muat di sini, pertama kali masuk seksi katalog semua combobox
     * kosong dan pemetaan tersimpan tampak hilang.
     *
     * Guard `melostore.length === 0`: sekali termuat, pindah-pindah seksi
     * tidak menarik ulang payload 8.000+ SKU.
     */
    if (
      (section === "catalog" || section === "supplier") &&
      supplierCatalog.melostore.length === 0
    ) {
      void muatKandidatSupplier().catch(() => {
        /* Gagal memuat kandidat bukan alasan menggagalkan seksi katalog -
         * data tersimpan tetap tampil lewat fallback product.melostore. */
      });
    }
    if (section === "affiliates" && !affiliateData) {
      void loadAffiliates().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Affiliate ledger gagal dimuat.",
        ),
      );
    }
    if (section === "promotions" && !promotionData) {
      void loadPromotions().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Promo gagal dimuat.",
        ),
      );
    }
    if (section === "users") {
      if (!usersData) {
        void loadUsers().catch((error) =>
          setNotice(
            error instanceof Error ? error.message : "Data user gagal dimuat.",
          ),
        );
      }
      /*
       * Dimuat terpisah dari `usersData` supaya kegagalan satu tidak
       * memblokir yang lain. Role admin biasa akan selalu mendapat 403 di
       * sini, dan itu jawaban yang benar - bukan kondisi yang perlu
       * ditampilkan sebagai galat.
       */
      if (!adminAccounts && canManageAdmins(adminRole)) {
        void loadAdminAccounts().catch((error) =>
          setNotice(
            error instanceof Error ? error.message : "Daftar admin gagal dimuat.",
          ),
        );
      }
    }
    if (section === "finance" && !financeData) {
      void loadFinance().catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Financial reconciliation gagal dimuat.",
        ),
      );
    }
    if (section === "cashflow" && !cashFlowData) {
      void loadCashFlow().catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Laporan arus kas gagal dimuat.",
        ),
      );
    }
    if (section === "transactions" && !txReport) {
      void loadTransactions().catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Laporan transaksi gagal dimuat.",
        ),
      );
    }
    if (section === "merchants" && !merchantData) {
      void loadMerchants().catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Data toko ritel gagal dimuat.",
        ),
      );
    }
    /*
     * Form "buat toko baru" perlu mulai ada begitu tab dibuka, kalau tidak
     * semua input terkunci (`merchantForm` null = semua handler mengembalikan
     * nilai yang sama) dan admin bingung kenapa tidak bisa mengetik apa pun.
     */
    if (section === "merchants" && merchantData && !merchantForm) {
      setMerchantForm(blankMerchantForm());
    }
    if (section === "system" && !readiness) {
      void loadReadiness().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Readiness check gagal dimuat.",
        ),
      );
    }
  }, [section, authState, orders.length, receipts.length, pointsData, affiliateData, promotionData, usersData, financeData, merchantData, readiness, supplierCatalog]);

  function updateDraft(productId: string, patch: Partial<DraftProduct>) {
    setDrafts((current) => ({
      ...current,
      [productId]: {
        ...current[productId]!,
        ...patch,
      },
    }));
  }

  async function saveProduct(product: CatalogProduct) {
    const draft = drafts[product.id];
    if (!draft) return;

    setBusy(`save:${product.id}`);
    setNotice("");
    try {
      await persistProduct(product, draft);
      await Promise.all([loadCatalog(), loadOverview()]);
      setNotice(`${product.id} berhasil diperbarui.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Produk gagal diperbarui.",
      );
    } finally {
      setBusy("");
    }
  }

  function setActionState(action: string, state: Partial<ActionState>) {
    setActionStates((current) => ({
      ...current,
      [action]: {
        status: state.status ?? current[action]?.status ?? "idle",
        message: state.message ?? current[action]?.message ?? "",
        at: state.at !== undefined ? state.at : (current[action]?.at ?? null),
      },
    }));
  }

  /**
   * Tombol utama: sinkron penuh dengan katalog Digiflazz. Mapping selalu
   * mengikuti supplier_sku — tidak ada lagi pencocokan tebakan, sehingga tidak
   * mungkin tertukar varian SKU antar game.
   */
  async function syncCatalogWithDigiflazz() {
    const confirmed = await confirm({
      title: "Sinkronkan katalog dengan Digiflazz?",
      description:
        "SKU baru akan dibuatkan produk, harga modal disegarkan, dan produk tanpa SKU di Digiflazz akan disembunyikan dari etalase.",
      details: [
        { label: "Sumber", value: "Digiflazz price-list" },
        { label: "Mapping", value: "Persis ke supplier_sku" },
      ],
      confirmLabel: "Sinkronkan sekarang",
    });
    if (!confirmed) return;

    setBusy("sync-catalog");
    setNotice("");
    setActionState("automap", { status: "running", message: "Membaca katalog Digiflazz..." });

    try {
      const response = await fetch("/api/admin/digiflazz/sync-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const result = (await response.json()) as {
        error?: string;
        summary?: CatalogSyncSummaryResult;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Sinkron katalog gagal.");
      }

      await Promise.all([loadCatalog(), loadOverview()]);

      const s = result.summary;
      const parts = [
        `${s?.productsCreated ?? 0} produk baru`,
        `${s?.mappingsCreated ?? 0} mapping`,
        `${s?.costsRefreshed ?? 0} harga modal diperbarui`,
      ];
      if ((s?.productsRemoved ?? 0) > 0) {
        parts.push(`${s?.productsRemoved} produk dihapus (SKU tak ada di Digiflazz)`);
      }
      if ((s?.productsHidden ?? 0) > 0) {
        parts.push(`${s?.productsHidden} disembunyikan (punya riwayat order)`);
      }
      if ((s?.failures?.length ?? 0) > 0) {
        parts.push(`${s?.failures.length} batch gagal`);
      }
      const message = parts.join(", ");
      setNotice(
        `Sinkron selesai (${s?.catalogSource === "cache" ? "cache" : "live"}): ${message}.` +
          (s?.staleWarning ? ` ${s.staleWarning}` : ""),
      );
      setActionState("automap", {
        status: (s?.failures?.length ?? 0) > 0 ? "error" : "ok",
        message,
        at: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sinkron katalog gagal.";
      setNotice(message);
      setActionState("automap", { status: "error", message, at: new Date().toISOString() });
    } finally {
      setBusy("");
    }
  }

  async function runBootstrap(apply: boolean) {
    const action = apply ? "automap" : "scan";

    // Scan hanya membaca, jadi tidak perlu konfirmasi. Auto-map menulis mapping
    // produk sehingga perlu konfirmasi eksplisit.
    if (apply) {
      const confirmed = await confirm({
        title: "Jalankan auto-map aman?",
        description:
          "Produk yang kecocokannya aman akan langsung dipetakan ke SKU supplier, dan mapping itu dipakai saat checkout.",
        confirmLabel: "Jalankan auto-map",
      });
      if (!confirmed) return;
    }

    setBusy(apply ? "bootstrap-apply" : "bootstrap-scan");
    setNotice("");
    setActionState(action, { status: "running", message: "Sedang berjalan..." });
    try {
      const response = await fetch("/api/admin/digiflazz/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, remap: false }),
      });
      const result = (await response.json()) as BootstrapResult & {
        error?: string;
        mirror?: CatalogSyncSummaryResult;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Bootstrap Digiflazz gagal.");
      }

      if (apply) await Promise.all([loadCatalog(), loadOverview()]);
      // Pencocokan skor sudah dihapus; angka yang tampil sekarang berasal dari
      // rekonsiliasi katalog yang sama dipakai semua tool sinkron.
      const mirror = result.mirror;
      const message = mirror
        ? `${mirror.catalogItems} SKU, ${mirror.productsCreated} produk baru, ${mirror.productsRemoved} dihapus, ${mirror.productsHidden} disembunyikan`
        : `${result.summary?.unmapped ?? 0} belum mapped.`;
      setNotice(
        apply
          ? `Auto-map selesai. ${message}.`
          : `Scan selesai. ${message}. Jalankan "Sinkron ke Digiflazz" untuk menerapkan.`,
      );
      setActionState(action, { status: "ok", message, at: new Date().toISOString() });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Bootstrap Digiflazz gagal.";
      setNotice(message);
      setActionState(action, { status: "error", message, at: new Date().toISOString() });
    } finally {
      setBusy("");
    }
  }

  async function syncPrices() {
    const confirmed = await confirm({
      title: "Sinkronkan harga supplier?",
      description:
        "Harga modal dari Digiflazz akan diperbarui, harga jual dinaikkan bila di bawah modal + profit, dan katalog direkonsiliasi supaya produk tetap persis mengikuti SKU Digiflazz.",
      confirmLabel: "Sinkronkan harga",
    });
    if (!confirmed) return;

    setBusy("sync");
    setNotice("");
    setActionState("sync", { status: "running", message: "Sedang mengambil harga..." });
    try {
      const response = await fetch("/api/admin/digiflazz/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const result = (await response.json()) as {
        error?: string;
        summary?: {
          found?: number;
          costChanged?: number;
          missing?: number;
        };
        mirror?: CatalogSyncSummaryResult;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Sinkronisasi harga gagal.");
      }

      await Promise.all([loadCatalog(), loadOverview()]);
      const message =
        `${result.summary?.found ?? 0} SKU, ${result.summary?.costChanged ?? 0} harga berubah` +
        (result.mirror
          ? `; katalog: ${result.mirror.productsCreated} produk baru, ${result.mirror.productsRemoved} dihapus, ${result.mirror.productsHidden} disembunyikan`
          : "");
      setNotice(`Sync harga selesai. ${message}. Mapping produk ikut direkonsiliasi.`);
      setActionState("sync", { status: "ok", message, at: new Date().toISOString() });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sinkronisasi harga gagal.";
      setNotice(message);
      setActionState("sync", { status: "error", message, at: new Date().toISOString() });
    } finally {
      setBusy("");
    }
  }

  async function checkBalance() {
    setBusy("balance");
    setNotice("");
    setActionState("balance", { status: "running", message: "Menghubungi supplier..." });
    try {
      const response = await fetch("/api/admin/digiflazz/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: false }),
      });
      const result = (await response.json()) as {
        error?: string;
        availableBalance?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Cek saldo gagal.");

      await Promise.all([loadCatalog(), loadOverview()]);
      const message = `${formatIDR(result.availableBalance ?? 0)} tersedia.`;
      setNotice(`Saldo diperbarui: ${message}`);
      setActionState("balance", { status: "ok", message, at: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cek saldo gagal.";
      setNotice(message);
      setActionState("balance", { status: "error", message, at: new Date().toISOString() });
    } finally {
      setBusy("");
    }
  }

  /*
   * Perbarui saldo Melostore lewat aksi "balance" yang sudah ada di
   * route sinkronisasi Melostore - sama dengan tombol "Perbarui saldo"
   * di panel pemetaan. Setelah tersimpan, katalog dan overview dimuat
   * ulang supaya angka baru langsung tampil di kedua seksi.
   */
  async function perbaruiSaldoMelostore() {
    setBusy("melostore-balance");
    setNotice("");
    setActionState("melostore-balance", {
      status: "running",
      message: "Menghubungi Melostore...",
    });
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "balance" }),
      });
      const result = (await response.json()) as {
        error?: string;
        balance?: number;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Saldo Melostore gagal diperbarui.");
      }

      await Promise.all([loadCatalog(), loadOverview()]);
      const message = `${formatIDR(result.balance ?? 0)} tersedia.`;
      setNotice(`Saldo Melostore diperbarui: ${message}`);
      setActionState("melostore-balance", {
        status: "ok",
        message,
        at: new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Saldo Melostore gagal diperbarui.";
      setNotice(message);
      setActionState("melostore-balance", {
        status: "error",
        message,
        at: new Date().toISOString(),
      });
    } finally {
      setBusy("");
    }
  }

  async function testTelegram() {
    setBusy("telegram");
    setNotice("");
    setActionState("telegram", { status: "running", message: "Mengirim pesan tes..." });
    try {
      const response = await fetch("/api/admin/telegram/test", { method: "POST" });
      const result = (await response.json()) as { error?: string; sent?: boolean };
      if (!response.ok) throw new Error(result.error ?? "Tes Telegram gagal.");

      setNotice("Pesan tes terkirim ke chat admin Telegram.");
      setActionState("telegram", {
        status: "ok",
        message: "Terkirim",
        at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tes Telegram gagal.";
      setNotice(message);
      setActionState("telegram", {
        status: "error",
        message,
        at: new Date().toISOString(),
      });
    } finally {
      setBusy("");
    }
  }

  async function dispatchTelegramQueue() {
    setBusy("telegram_queue");
    setNotice("");
    setActionState("telegram_queue", {
      status: "running",
      message: "Mengirim antrean...",
    });
    try {
      const response = await fetch("/api/admin/telegram/dispatch", { method: "POST" });
      const result = (await response.json()) as {
        error?: string;
        attempted?: number;
        sent?: number;
        failed?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Antrean gagal diproses.");

      const message = `Antrean: ${result.attempted ?? 0} dicoba, ${result.sent ?? 0} terkirim, ${result.failed ?? 0} gagal.`;
      setNotice(message);
      setActionState("telegram_queue", {
        status: (result.failed ?? 0) > 0 ? "error" : "ok",
        message,
        at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Antrean gagal diproses.";
      setNotice(message);
      setActionState("telegram_queue", {
        status: "error",
        message,
        at: new Date().toISOString(),
      });
    } finally {
      setBusy("");
    }
  }

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    const keyword = query.trim().toLowerCase();

    const filtered = catalog.products.filter((product) => {
      if (gameFilter !== "all" && product.gameId !== gameFilter) return false;
      if (mappingFilter === "mapped" && !product.supplier.mapped) return false;
      if (mappingFilter === "unmapped" && product.supplier.mapped) return false;
      if (mappingFilter === "ready" && !product.supplier.ready) return false;
      if (statusFilter === "active" && !product.active) return false;
      if (statusFilter === "inactive" && product.active) return false;
      if (statusFilter === "edited") {
        const draft = drafts[product.id];
        if (!draft || !isDraftDirty(product, draft)) return false;
      }
      if (marginFilter !== "all") {
        const draft = drafts[product.id];
        const info = marginOf(
          product,
          Number(draft?.sellingPrice ?? product.sellingPrice),
        );
        if (marginFilter === "loss" && (!info || info.margin >= 0)) return false;
        if (marginFilter === "thin" && (!info || info.margin < 0 || info.percent >= 5))
          return false;
        if (marginFilter === "no-cost" && info !== null) return false;
      }
      if (!keyword) return true;

      return `${product.id} ${product.gameName} ${product.gameShortName} ${product.label} ${product.supplier.sku ?? ""}`
        .toLowerCase()
        .includes(keyword);
    });

    // Urutan sama seperti halaman pembelian: per game, pass/langganan di atas,
    // lalu jumlah kecil ke besar.
    return filtered.sort((a, b) =>
      a.gameId === b.gameId
        ? compareCatalogItems(a, b)
        : a.gameId.localeCompare(b.gameId),
    );
  }, [catalog, query, gameFilter, mappingFilter, statusFilter, marginFilter, drafts]);

  /*
   * Halaman aman: filter berubah saat operator ada di halaman 40 bisa
   * membuat halaman itu kosong - dijepit ke halaman terakhir yang ada,
   * tanpa efek samping atau render ekstra.
   */
  const KATALOG_PER_HALAMAN = 25;
  const katalogTotalHalaman = Math.max(
    1,
    Math.ceil(filteredProducts.length / KATALOG_PER_HALAMAN),
  );
  const katalogHalaman = Math.min(katalogPage, katalogTotalHalaman);
  const katalogBaris = filteredProducts.slice(
    (katalogHalaman - 1) * KATALOG_PER_HALAMAN,
    katalogHalaman * KATALOG_PER_HALAMAN,
  );

  const dirtyProductCount = useMemo(() => {
    if (!catalog) return 0;
    return catalog.products.filter((product) => {
      const draft = drafts[product.id];
      return draft ? isDraftDirty(product, draft) : false;
    }).length;
  }, [catalog, drafts]);

  // Kelompok varian nominal: produk dengan jumlah mata uang yang sama di game
  // yang sama (mis. tiga SKU "86 Diamond" dari channel supplier berbeda).
  // Dipakai fitur bandingkan agar admin bisa menyelaraskan harga antar varian.
  const duplicateVariantGroups = useMemo(() => {
    const groups = new Map<string, CatalogProduct[]>();
    if (!catalog) return groups;
    for (const product of catalog.products) {
      const amount = extractNominalAmount(product.label);
      if (amount === null) continue;
      const key = `${product.gameId}::${amount}`;
      const list = groups.get(key) ?? [];
      list.push(product);
      groups.set(key, list);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) groups.delete(key);
    }
    return groups;
  }, [catalog]);

  function variantKeyOf(product: CatalogProduct) {
    const amount = extractNominalAmount(product.label);
    return amount === null ? null : `${product.gameId}::${amount}`;
  }

  function suggestionFor(product: CatalogProduct) {
    const cost = product.supplier.cost;
    if (cost === null) return null;
    const selling = Number(suggestPercent);
    const reference = Number(suggestRefPercent);
    return suggestPriceFromCost({
      cost,
      sellingMarkupPercent: Number.isFinite(selling) ? selling : 5,
      referenceMarkupPercent: Number.isFinite(reference) ? reference : 10,
    });
  }

  function applySuggestion(product: CatalogProduct) {
    const suggestion = suggestionFor(product);
    if (!suggestion) return;
    updateDraft(product.id, {
      sellingPrice: String(suggestion.sellingPrice),
      referencePrice: String(suggestion.referencePrice),
    });
  }

  function applyVariantPrice(product: CatalogProduct, variant: CatalogProduct) {
    updateDraft(product.id, {
      sellingPrice: String(variant.sellingPrice),
      referencePrice: String(variant.referencePrice),
    });
  }

  async function applyBulkPercent() {
    const percent = Number(bulkPercent);
    if (!Number.isFinite(percent) || percent === 0 || Math.abs(percent) > 90) {
      setNotice("Persen penyesuaian harus di antara -90% dan 90% (bukan 0).");
      return;
    }
    if (filteredProducts.length === 0) {
      setNotice("Tidak ada produk terfilter untuk disesuaikan.");
      return;
    }
    const confirmed = await confirm({
      title: `Sesuaikan harga ${percent > 0 ? "+" : ""}${percent}%?`,
      description:
        'Harga jual dan harga coret untuk produk terfilter akan diubah, lalu dibulatkan ke Rp100 terdekat. Perubahan masuk ke draft — tinjau dulu sebelum klik "Simpan semua".',
      details: [
        { label: "Produk terdampak", value: String(filteredProducts.length) },
        { label: "Perubahan", value: `${percent > 0 ? "+" : ""}${percent}%` },
      ],
      confirmLabel: "Terapkan ke draft",
    });
    if (!confirmed) return;

    setDrafts((current) => {
      const next = { ...current };
      for (const product of filteredProducts) {
        const draft = next[product.id] ?? draftFromProduct(product);
        const selling = Number(draft.sellingPrice) || product.sellingPrice;
        const reference = Number(draft.referencePrice) || product.referencePrice;
        next[product.id] = {
          ...draft,
          sellingPrice: String(roundTo100(selling * (1 + percent / 100))),
          referencePrice: String(roundTo100(reference * (1 + percent / 100))),
        };
      }
      return next;
    });
    setNotice(
      `Draft ${filteredProducts.length} produk disesuaikan ${percent > 0 ? "+" : ""}${percent}%. Tinjau lalu klik "Simpan semua".`,
    );
  }

  function adjustDraftPrice(product: CatalogProduct, percent: number) {
    const draft = drafts[product.id] ?? draftFromProduct(product);
    const selling = Number(draft.sellingPrice) || product.sellingPrice;
    const reference = Number(draft.referencePrice) || product.referencePrice;
    updateDraft(product.id, {
      sellingPrice: String(roundTo100(selling * (1 + percent / 100))),
      referencePrice: String(roundTo100(reference * (1 + percent / 100))),
    });
  }

  /**
   * Kembalikan harga jual & coret ke harga saran dari modal supplier
   * termurah (opsi yang dipilih operator: bukan menyetel harga = modal).
   *
   * Dasarnya modal TERMAHURAH - sama dengan yang akan dipilih checkout.
   * Persen markup memakai panel Saran yang sedang aktif, supaya reset
   * dan "Terapkan ke terfilter" menghasilkan angka yang sama untuk
   * produk yang sama.
   */
  function resetHargaKeSupplier(product: CatalogProduct) {
    const cost = product.cheapestCost;
    if (cost === null || !Number.isFinite(cost) || cost <= 0) {
      setNotice(
        `${product.label}: belum ada harga modal supplier untuk reset harga.`,
      );
      return;
    }
    updateDraft(product.id, {
      sellingPrice: String(
        roundTo100(cost * (1 + Number(suggestPercent) / 100)),
      ),
      referencePrice: String(
        roundTo100(cost * (1 + Number(suggestRefPercent) / 100)),
      ),
    });
  }

  function resetDraft(product: CatalogProduct) {
    setDrafts((current) => ({
      ...current,
      [product.id]: draftFromProduct(product),
    }));
  }

  async function muatKandidatSupplier() {
    try {
      const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Kandidat supplier gagal dimuat.");
      }
      const data = (await response.json()) as {
        rows: Array<{ productId: string; mappedSku: string | null; autoSku: string | null }>;
        supplier: { configured: boolean; catalogSize: number; error: string | null };
        options: {
          digiflazz: Array<{ sku: string; name: string; cost: number }>;
          melostore: Array<{
            sku: string;
            name: string;
            cost: number;
            brand: string | null;
          }>;
        };
      };

      /*
       * Daftar SKU per supplier diisi dari `options` - katalog yang
       * ter-cache di supplier_catalog_items. Tanpa ini, state supplierCatalog
       * tetap kosong dan combobox tidak punya apa pun untuk dicari:
       * itulah penyebab "SKU Melostore tidak ada di dropdown".
       */
      setSupplierCatalog({
        digiflazz: data.options?.digiflazz ?? [],
        melostore: data.options?.melostore ?? [],
        error: data.supplier.error ?? null,
      });

      /*
       * Pick diisi dari mapping yang BENAR-BENAR TERSIMPAN saja.
       * AutoSku adalah SARAN untuk combobox, bukan keadaan database -
       * memasukkannya ke pick berarti membuka halaman sudah mengubah
       * mapping begitu operator menekan Simpan.
       */
      const pick: Record<string, string> = {};
      const tersimpan: Record<string, string | null> = {};
      for (const row of data.rows) {
        tersimpan[row.productId] = row.mappedSku;
        if (row.mappedSku) pick[row.productId] = row.mappedSku;
      }
      setMelostorePick(pick);
      setMelostoreTersimpan(tersimpan);
      /* Katalog supplier diisi dari options (sudah di-cache di DB) */
      setSupplierCatalog({
        digiflazz: data.options?.digiflazz ?? [],
        melostore: data.options?.melostore ?? [],
        error: data.supplier?.error ?? null,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kandidat supplier gagal dimuat.");
    }
  }

  /**
   * Simpan satu baris katalog: produk (label/harga/status) DAN pemetaan
   * Melostore kalau pilihannya berubah.
   *
   * Dua permintaan, karena keduanya beda endpoint dan beda verifikasi -
   * tapi dibungkus satu fungsi supaya tombol Simpan di baris punya satu
   * makna: "apa yang saya lihat di baris ini tersimpan semuanya".
   * Mapping yang tidak berubah tidak dikirim ulang.
   */
  async function simpanBarisKatalog(product: CatalogProduct) {
    const draft = drafts[product.id] ?? draftFromProduct(product);
    /*
     * Nilai efektif dengan fallback yang sama dengan tampilan baris:
     * kalau muatKandidatSupplier belum pernah berjalan, pick/tersimpan
     * dibaca dari data API katalog - bukan string kosong. Tanpa fallback,
     * menyimpan baris yang mapping-nya ada akan mengirim "clear" palsu
     * (pick "" != tersimpan sebenarnya) dan menghapus pemetaan diam-diam.
     */
    const pick = melostorePick[product.id] ?? product.melostore.sku ?? "";
    const tersimpan =
      melostoreTersimpan[product.id] ?? product.melostore.sku ?? "";

    const pekerjaan: Array<Promise<void>> = [];

    if (isDraftDirty(product, draft)) {
      pekerjaan.push(
        (async () => {
          await persistProduct(product, draft);
        })(),
      );
    }

    if (pick !== tersimpan) {
      pekerjaan.push(
        (async () => {
          await terapkanMappingMelostore(product, pick);
          setMelostoreTersimpan((current) => ({
            ...current,
            [product.id]: pick || null,
          }));
        })(),
      );
    }

    if (pekerjaan.length === 0) return;

    setBusy(`save:${product.id}`);
    try {
      await Promise.all(pekerjaan);
      await loadCatalog();
    } finally {
      setBusy("");
    }
  }

  /**
   * Hapus permanen produk DRAFT beserta pemetaan suppliernya.
   *
   * Konfirmasi lewat dialog admin (useConfirm), bukan window.confirm -
   * aksi ini menghapus baris database secara permanen, dan dialog
   * menampilkan identitas produk sebelum admin menekan tombolnya.
   *
   * Backend menolak produk aktif (harus dinonaktifkan dulu) dan produk
   * ber riwayat order - pesan penolakannya diteruskan apa adanya supaya
   * operator tahu kenapa, bukan hanya "gagal".
   */
  async function hapusPermanenDraft(product: CatalogProduct) {
    const draft = drafts[product.id] ?? draftFromProduct(product);
    const confirmed = await confirm({
      title: `Hapus permanen "${draft.label}"?`,
      description:
        "Produk draft beserta pemetaan supplier Digiflazz/Melostore-nya dihapus dari database. Tidak bisa dibatalkan.",
      details: [
        { label: "Produk", value: draft.label },
        { label: "SKU internal", value: product.internalSku ?? "(belum ada)" },
      ],
      confirmLabel: "Hapus permanen",
      tone: "danger",
    });
    if (!confirmed) return;

    setBusy(`delete:${product.id}`);
    try {
      const response = await fetch(
        "/api/admin/catalog/" + encodeURIComponent(product.id),
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Produk gagal dihapus.");
      }
      setNotice(data.message ?? "Produk dihapus permanen.");
      setDrafts((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      await loadCatalog();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Produk gagal dihapus.");
    } finally {
      setBusy("");
    }
  }

  /** Panggilan API pemetaan Melostore, tanpa busy/notice miliknya. */
  async function terapkanMappingMelostore(product: CatalogProduct, sku: string) {
    const response = await fetch("/api/admin/digiflazz/melostore-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: sku ? "apply" : "clear", productId: product.id, sku }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Pemetaan Melostore gagal disimpan.");
    }
  }

  async function simpanMappingMelostore(product: CatalogProduct, sku: string) {
    setMelostoreBusy(product.id);
    try {
      await terapkanMappingMelostore(product, sku);
      setNotice(
        sku
          ? `${product.label} dipetakan ke Melostore ${sku}.`
          : `Pemetaan Melostore untuk ${product.label} dikosongkan.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Pemetaan Melostore gagal disimpan.");
    } finally {
      setMelostoreBusy("");
    }
  }

  async function persistProduct(product: CatalogProduct, draft: DraftProduct) {
    const sellingPrice = Number(draft.sellingPrice);
    const referencePrice = Number(draft.referencePrice);
    const nextSku = draft.supplierSku.trim();
    const currentSku = product.supplier.sku ?? "";

    if (!Number.isInteger(sellingPrice) || sellingPrice <= 0) {
      throw new Error(`${product.id}: harga jual tidak valid.`);
    }
    if (!Number.isInteger(referencePrice) || referencePrice < sellingPrice) {
      throw new Error(`${product.id}: reference price harus >= harga jual.`);
    }
    if (!nextSku && currentSku) {
      throw new Error(
        `${product.id}: SKU lama tidak boleh dikosongkan dari editor ini.`,
      );
    }

    const response = await fetch(
      `/api/admin/catalog/${encodeURIComponent(product.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label,
          note: draft.note || null,
          sellingPrice,
          referencePrice,
          active: draft.active,
          internalSku: draft.internalSku.trim() || null,
        }),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(result.error ?? `${product.id} gagal disimpan.`);
    }

    if (nextSku && nextSku.toUpperCase() !== currentSku.toUpperCase()) {
      const mappingResponse = await fetch("/api/admin/digiflazz/map-sku", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          supplierSku: nextSku,
        }),
      });
      const mapping = (await mappingResponse.json()) as { error?: string };
      if (!mappingResponse.ok) {
        throw new Error(mapping.error ?? `${product.id}: mapping SKU gagal.`);
      }
    }
  }

  async function saveAllDirty() {
    if (!catalog) return;
    const dirtyProducts = catalog.products.filter((product) => {
      const draft = drafts[product.id];
      return draft ? isDraftDirty(product, draft) : false;
    });
    if (dirtyProducts.length === 0) return;

    const confirmed = await confirm({
      title: `Simpan ${dirtyProducts.length} perubahan produk?`,
      description:
        "Harga yang sudah tersimpan langsung berlaku di etalase dan bisa dilihat pelanggan.",
      details: [
        { label: "Produk diubah", value: String(dirtyProducts.length) },
        { label: "Tujuan", value: "Katalog etalase" },
      ],
      confirmLabel: "Simpan semua",
    });
    if (!confirmed) return;

    setBusy("save-all");
    setNotice("");
    const failures: string[] = [];
    for (const product of dirtyProducts) {
      const draft = drafts[product.id];
      if (!draft) continue;
      try {
        await persistProduct(product, draft);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `${product.id} gagal.`);
      }
    }

    await Promise.all([loadCatalog(), loadOverview()]);
    setNotice(
      failures.length === 0
        ? `${dirtyProducts.length} produk berhasil disimpan.`
        : `${dirtyProducts.length - failures.length} tersimpan, ${failures.length} gagal: ${failures.slice(0, 3).join(" · ")}`,
    );
    setBusy("");
  }

  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (
        orderStatusFilter !== "all" &&
        order.status !== orderStatusFilter
      ) {
        return false;
      }
      if (!keyword) return true;
      return `${order.id} ${order.gameName} ${order.packageLabel} ${order.targetUserId}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [orders, orderStatusFilter, query]);

  /*
   * Paginasi daftar pesanan.
   *
   * Tanpa ini seluruh 100 order dirender sekaligus. Di monitor itu masih
   * terbaca, tapi di ponsel operator harus menggulir melewati semua baris
   * hanya untuk menemukan yang berstatus success - dan seluruh halaman
   * ikut menumpuk, membuat halaman terasa penuh tanpa perlu.
   *
   * Dipaginasi, bukan "muat lebih banyak", karena operator sering
   * menyaring status dulu lalu menelusuri seluruh hasilnya - hasilnya
   * selalu ada di halaman pertama, bukan tersebar di beberapa.
   *
   * Halaman dikembalikan ke awal setiap filter berubah: filter yang
   * menyisakan 2 hasil tidak boleh tetap berada di halaman 4 dan
   * menampilkan "tidak ada data".
   */
  const ORDERS_PER_PAGE = 25;
  const [orderPage, setOrderPage] = useState(0);

  const orderPageCount = Math.max(
    1,
    Math.ceil(filteredOrders.length / ORDERS_PER_PAGE),
  );
  const safeOrderPage = Math.min(orderPage, orderPageCount - 1);
  const visibleOrders = filteredOrders.slice(
    safeOrderPage * ORDERS_PER_PAGE,
    safeOrderPage * ORDERS_PER_PAGE + ORDERS_PER_PAGE,
  );

  // Kembalikan ke halaman pertama saat filter berubah.
  useEffect(() => {
    setOrderPage(0);
  }, [query, orderStatusFilter]);

  /*
   * Hal-hal yang benar-benar butuh tindakan operator.
   *
   * Sebelumnya semua angka ini ditampilkan sebagai kartu metrik dengan
   * bobot visual yang sama. Akibatnya "email receipt gagal" - satu hal
   * yang harus dibereskan hari ini - tampil berdampingan dengan "order
   * hari ini" yang cuma angka, dan operator harus menilai sendiri mana
   * yang penting setiap kali membuka halaman.
   *
   * Baris ini sengaja hanya dirender kalau isinya ada. Halaman yang
   * bersih karena memang tidak ada masalah lebih berguna daripada baris
   * "0 masalah" yang membuat pembaca mengira ada yang salah.
   *
   * `processing` dan `pendingPayment` sengaja TIDAK ikut di sini. Keduanya
   * kondisi normal sesaat - order sedang diproses, user belum transfer -
   * Memasukkannya akan membuat baris ini hampir selalu menyala,
   * selalu menyala, dan peringatan yang selalu menyala sama sekali bukan
   * peringatan.
   */
  const attentionItems = useMemo(() => {
    if (!overview) return [];
    const items: Array<{ id: string; title: string; detail: string }> = [];

    const receiptFailed = overview.stats.receiptsFailed ?? 0;
    if (receiptFailed > 0) {
      items.push({
        id: "receipt-failed",
        title: `${numberOrDash(receiptFailed)} email receipt gagal`,
        detail: "User sudah membayar tapi belum menerima bukti transfer.",
      });
    }

    const supplierPending = overview.stats.supplierPending ?? 0;
    if (supplierPending > 0) {
      items.push({
        id: "supplier-pending",
        title: `${numberOrDash(supplierPending)} order menunggu supplier`,
        detail: "Supplier belum mengirim status. Rekonsiliasi akan mengambilnya.",
      });
    }

    for (const service of overview.system.services) {
      if (service.state === "attention") {
        items.push({
          id: `service-${service.id}`,
          title: `${service.name} belum siap`,
          detail: service.detail,
        });
      }
    }

    return items;
  }, [overview]);

  /*
   * Baris "Catatan kas harian" hanya memuat hari yang ada geraknya.
   *
   * Grafik memang butuh semua hari - hari kosong penting agar grafik tidak
   * menyiratkan ada transaksi. Tabel berbeda: 30 hari kosong akan berubah
   * menjadi 30 baris nol yang tidak dibaca siapa pun, dan hari yang benar
   * ada isinya terdorong ke bawah.
   *
   * Baris TOTAL tetap mencakup seluruh periode, jadi menyembunyikan hari
   * sepi tidak mengubah angka mana pun - dan jumlah yang disembunyikan
   * disebut supaya operator tahu tabelnya tidak lengkap dengan sendirinya.
   */
  const cashFlowDaysDescending = (cashFlowData?.days ?? [])
    .filter(
      (day) =>
        day.orders > 0 ||
        day.grossRevenue > 0 ||
        day.merchantSettled > 0 ||
        day.supplierCost > 0 ||
        day.affiliatePaidOut > 0 ||
        day.gatewayFee > 0,
    )
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date));

  const hiddenCashFlowDayCount =
    (cashFlowData?.days.length ?? 0) - cashFlowDaysDescending.length;

  const cashFlowDayPageCount = Math.max(
    1,
    Math.ceil(cashFlowDaysDescending.length / CASH_DAYS_PER_PAGE),
  );
  // Dijepit supaya perubahan rentang tidak pernah menyisakan halaman
  // kosong di tabel yang isinya baru saja berkurang.
  const safeCashFlowDayPage = Math.min(cashFlowDayPage, cashFlowDayPageCount - 1);
  const cashFlowDayRows = cashFlowDaysDescending.slice(
    safeCashFlowDayPage * CASH_DAYS_PER_PAGE,
    (safeCashFlowDayPage + 1) * CASH_DAYS_PER_PAGE,
  );

  if (authState === "loading") {
    return (
      <main className="admin-shell">
        <div className="admin-loading">Memuat {BRAND.name} Control Center...</div>
      </main>
    );
  }

  if (authState === "guest") {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <Link className="brand" href="/">
            <span className="brand-mark"><img src="/logo/lacte-logo.svg" alt="" /></span>
            <span>{BRAND.shortName}</span>
          </Link>
          <span className="admin-kicker">Admin account</span>
          <h1>Masuk dengan akun admin.</h1>
          <p>
            Control Center memakai akun ${BRAND.shortName} dengan role admin atau
            superadmin.
          </p>
          <Link
            className="primary-button full admin-account-login"
            href="/login?next=%2Fadmin"
          >
            Masuk ke akun admin <span>→</span>
          </Link>
          {notice && <p className="admin-notice error">{notice}</p>}
        </section>
      </main>
    );
  }

  if (authState === "forbidden") {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <Link className="brand" href="/">
            <span className="brand-mark"><img src="/logo/lacte-logo.svg" alt="" /></span>
            <span>{BRAND.shortName}</span>
          </Link>
          <span className="admin-kicker">Akses ditolak</span>
          <h1>Akun ini bukan admin.</h1>
          <p>
            {adminUser?.email
              ? `${adminUser.email} sudah login tetapi belum memiliki role admin.`
              : "Akun ini belum memiliki role admin."}
          </p>
          <button
            type="button"
            onClick={() => {
              // Logout ditulis di tempat, bukan fungsi terpisah, karena
              // sidebar sudah punya salinannya sendiri, dan menduplikasi
              // endpoint di dua tempat mudah menghasilkan perilaku beda.
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
            Keluar & ganti akun
          </button>
        </section>
      </main>
    );
  }

  const activeNav = NAV.find((item) => item.id === section) ?? NAV[0]!;

  return (
    <section className="acc-page-sub">
      <section className="acc-workspace">
        {/*
         * Tombol drawer TIDAK ada di sini. Sidebar sekarang dirender oleh
         * `layout.tsx` untuk semua route `/admin`, dan tombolnya ikut
         * di sana - jadi menyalinnya ke sini hanya akan menghasilkan dua
         * tombol yang mengatur state berbeda.
         */}
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            {/*
             * Breadcrumb sebelumnya menulis "Admin / Ringkasan" di atas
             * "Ringkasan" - nama seksi yang sama dua kali bersebelahan.
             * Sekarang baris atas menunjukkan GRUP-nya, jadi dua baris ini
             * memberi informasi berbeda:Toko Ritel tahu ada di grup
             * "Keuangan", bukan di "Katalog".
             */}
            <small>{activeNav.group}</small>
            <strong>{activeNav.label}</strong>
          </div>
          <div className="acc-topbar-actions">
            {overview?.system.flowTest && (
              <span className="acc-env-badge">FLOW TEST</span>
            )}
            <button
              type="button"
              onClick={() => void refreshCurrent()}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? "Memuat ulang..." : "Muat ulang"}
            </button>
            <Link href="/" target="_blank">
              Website ↗
            </Link>
            {/*
             * Tautan dokumentasi selalu terlihat, bukan hanya saat sedang
             * bingung. Masalahnya dokumentasi yang hanya muncul kalau
             * sudah diketahuidi adalah dokumentasi yang tidak pernah dibaca.
             */}
            <Link href="/admin/docs">Panduan</Link>
          </div>
        </header>

        {notice && (
          <div className="acc-global-notice" role="status">
            {notice}
          </div>
        )}

        <div className="acc-content">
          {section === "overview" && overview && (
            <>
              <section className="acc-hero">
                <div>
                  <span className="acc-eyebrow">Ringkasan operasional</span>
                  <h1>Semua yang penting, satu layar.</h1>
                  <p>
                    Pantau order, supplier, receipt, pricing, dan kesiapan
                    sistem tanpa membuka database satu per satu.
                  </p>
                </div>
                <div className="acc-balance-stack">
                  <div className="acc-balance">
                    <small>Saldo Digiflazz tersedia</small>
                    <strong>{formatIDR(overview.finance.availableBalance)}</strong>
                    <span>
                      Diperiksa {formatTime(overview.finance.balanceCheckedAt)}
                    </span>
                  </div>
                  {/*
                   * Kotak kedua: supplier pembanding. Null berarti saldo
                   * Melostore belum pernah ditarik - ditulis terus terang,
                   * bukan "Rp 0" yang terlihat seperti saldo kosong.
                   */}
                  <div className="acc-balance is-compact">
                    <small>Saldo Melostore</small>
                    {overview.finance.melostoreBalance !== null ? (
                      <>
                        <strong>{formatIDR(overview.finance.melostoreBalance)}</strong>
                        <span>
                          Update {formatTime(overview.finance.melostoreCheckedAt)}
                        </span>
                      </>
                    ) : (
                      <strong className="acc-balance-empty">
                        Belum disinkron
                      </strong>
                    )}
                  </div>
                </div>
              </section>

              {attentionItems.length > 0 && (
                <section className="acc-attention">
                  <div className="acc-attention-head">
                    <span className="acc-attention-dot" />
                    <strong>Perlu perhatian</strong>
                    <small>{attentionItems.length} hal menunggu</small>
                  </div>
                  <div className="acc-attention-list">
                    {attentionItems.map((item) => (
                      <div key={item.id}>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="acc-metrics acc-metrics-three">
                <article>
                  <small>Order hari ini</small>
                  <strong>{numberOrDash(overview.stats.ordersToday)}</strong>
                  <span>{numberOrDash(overview.stats.successToday)} berhasil</span>
                </article>
                <article>
                  <small>Omzet hari ini</small>
                  <strong>
                    {formatIDR(overview.finance.revenueToday)}
                  </strong>
                  {/*
                   * Dua catatan muncul bergantian supaya kartu tidak jadi
                   * tinggi. Keduanya menjelaskan kenapa angkanya BUKAN
                   * "GMV" mentah, dan keduanya perlu terlihat - Rp yang
                   * terlihat lebih besar dari kenyataannya akan dipercaya.
                   */}
                  {overview.finance.ordersMissingPaidAt > 0 ? (
                    <span className="acc-metric-warn">
                      {numberOrDash(overview.finance.ordersMissingPaidAt)}{" "}
                      order tanpa catatan pembayaran tidak ikut
                    </span>
                  ) : overview.finance.retailReceivableToday > 0 ? (
                    <span>
                      + {formatIDR(overview.finance.retailReceivableToday)}{" "}
                      ditunggu dari toko ritel
                    </span>
                  ) : (
                    <span>dari order yang pembayarannya sudah masuk</span>
                  )}
                </article>
                <article>
                  <small>Sedang diproses</small>
                  <strong>{numberOrDash(overview.stats.processing)}</strong>
                  <span>{numberOrDash(overview.stats.pendingPayment)} menunggu pembayaran</span>
                </article>
              </section>

              <section className="acc-grid-two">
                <div className="acc-panel">
                  <SectionHead
                    eyebrow="Aktivitas terbaru"
                    title="Pesanan terbaru"
                    copy="10 transaksi terakhir yang masuk ke sistem."
                    action={
                      <button
                        className="acc-inline-button"
                        type="button"
                        onClick={() => setSection("orders")}
                      >
                        Lihat semua →
                      </button>
                    }
                  />
                  <div className="acc-order-list">
                    {overview.recentOrders.map((order) => (
                      <div className="acc-order-row" key={order.id}>
                        <div>
                          <small>{order.id}</small>
                          <strong>{order.gameName}</strong>
                          <span>{order.packageLabel}</span>
                        </div>
                        <b>{formatIDR(order.finalPrice)}</b>
                        <span className={`acc-status ${order.status}`}>
                          {STATUS_LABEL[order.status] ?? order.status}
                        </span>
                      </div>
                    ))}
                    {overview.recentOrders.length === 0 && (
                      <div className="acc-empty">Belum ada order.</div>
                    )}
                  </div>
                </div>

                <div className="acc-panel">
                  <SectionHead
                    eyebrow="Kesehatan sistem"
                    title="Integrasi"
                    copy={`Status konfigurasi service utama ${BRAND.shortName}.`}
                  />
                  <div className="acc-service-list">
                    {overview.system.services.map((service) => (
                      <div className="acc-service-row" key={service.id}>
                        <span className={`acc-health ${service.state}`} />
                        <div>
                          <strong>{service.name}</strong>
                          <small>{service.detail}</small>
                        </div>
                        <b>{service.state}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/*
                PaymentGatewayPanel (konfigurasi Midtrans) dan blok peta
                jalan DIHAPUS dari Ringkasan, bukan dipindah.

                Keduanya dokumentasi teknis, bukan pekerjaan operator. Yang
                referensi, bukan sesuatu yang dikerjakan hari ini. Menaruh
                referensi, bukan sesuatu yang dikerjakan hari ini. Menaruh
                keduanya di halaman landing membuat Ringkasan berisi tiga
                audiens berbeda sekaligus - operator, admin, dan pembaca
                dokumentasi - sementara hanya yang pertama yang setiap hari
                dibuka.

                PaymentGatewayPanel sudah ada di halaman Sistem. Peta jalan
                juga sudah ada di sana (enam kartu), jadi daftar sepuluh
                kartu di sini tidak menambah informasi baru - hanya
                mengulanginya dengan kalimat lebih panjang.

                Kalau nanti konfigurasi gateway memang perlu diubah dari
                dashboard, tombol di System sudah cukup jadi pintu masuk.
              */}
            </>
          )}

          {section === "orders" && (
            <>
              <SectionHead
                eyebrow="Operasional"
                title="Pesanan"
                copy="Order terbaru. Saring untuk memeriksa status atau mencari order tertentu."
              />
              <div className="acc-filterbar">
                <input
                  type="search"
                  placeholder="Cari order, game, user ID..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value)}
                >
                  <option value="all">Semua status</option>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="acc-table-card">
                <div className="acc-orders-head">
                  <span>Order</span>
                  <span>Akun</span>
                  <span>Pembayaran</span>
                  <span>Total</span>
                  <span>Status</span>
                </div>
                {visibleOrders.map((order) => (
                  <div className="acc-orders-row" key={order.id}>
                    <div>
                      <small>{order.id}</small>
                      <strong>{order.gameName}</strong>
                      <span>{order.packageLabel}</span>
                    </div>
                    <div>
                      <strong>{order.targetUserId}</strong>
                      <span>
                        {order.targetServerId
                          ? `Zone ${order.targetServerId}`
                          : "Tanpa server"}
                      </span>
                    </div>
                    <div>
                      <strong>{order.paymentName ?? "-"}</strong>
                      <span>{formatTime(order.createdAt)}</span>
                    </div>
                    <strong>{formatIDR(order.finalPrice)}</strong>
                    <div className="acc-order-status-action">
                      <span className={`acc-status ${order.status}`}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void inspectOrder(order.id)}
                      >
                        Detail
                      </button>
                    </div>
                  </div>
                ))}
                {filteredOrders.length === 0 && (
                  <div className="acc-empty">Tidak ada order yang cocok.</div>
                )}

                {orderPageCount > 1 ? (
                  <div className="acc-tx-pagination">
                    <span>
                      Menampilkan{" "}
                      {safeOrderPage * ORDERS_PER_PAGE + 1}-
                      {Math.min(
                        (safeOrderPage + 1) * ORDERS_PER_PAGE,
                        filteredOrders.length,
                      )}{" "}
                      dari {filteredOrders.length} order
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={safeOrderPage === 0}
                        onClick={() => setOrderPage((page) => Math.max(0, page - 1))}
                      >
                        Sebelumnya
                      </button>
                      <span className="acc-tx-pageinfo">
                        {safeOrderPage + 1} / {orderPageCount}
                      </span>
                      <button
                        type="button"
                        disabled={safeOrderPage >= orderPageCount - 1}
                        onClick={() =>
                          setOrderPage((page) =>
                            Math.min(orderPageCount - 1, page + 1),
                          )
                        }
                      >
                        Berikutnya
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {orderDetail && (
                <section className="acc-order-inspector">
                  <div className="acc-order-inspector-head">
                    <div>
                      <small>ORDER INSPECTOR</small>
                      <strong>{String(orderDetail.order.id ?? "-")}</strong>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void retryAdminReceipt(
                            String(orderDetail.order.id ?? ""),
                          )
                        }
                      >
                        Retry receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderDetail(null)}
                      >
                        Tutup
                      </button>
                    </div>
                  </div>

                  <div className="acc-order-inspector-grid">
                    <article>
                      <small>Order financial</small>
                      <pre>{JSON.stringify(orderDetail.order, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Payment</small>
                      <pre>{JSON.stringify(orderDetail.payments, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Supplier / SN</small>
                      <pre>{JSON.stringify(orderDetail.supplierTransactions, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Receipt</small>
                      <pre>{JSON.stringify(orderDetail.receipts, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Commission</small>
                      <pre>{JSON.stringify(orderDetail.commissions, null, 2)}</pre>
                    </article>
                    <article>
                      <small>Poin / Promo</small>
                      <pre>{JSON.stringify({
                        points: orderDetail.points,
                        promotions: orderDetail.promotionRedemptions,
                      }, null, 2)}</pre>
                    </article>
                  </div>
                </section>
              )}
            </>
          )}

          {section === "catalog" && catalog && (
            <>
              <SectionHead
                eyebrow="Katalog"
                title="Produk & harga"
                copy="Edit label, harga, status, dan mapping SKU tanpa mengubah source supplier."
              />
              <div className="acc-filterbar acc-filterbar-three">
                <input
                  type="search"
                  placeholder="Cari produk, ID, SKU..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <select
                  value={gameFilter}
                  onChange={(event) => setGameFilter(event.target.value)}
                >
                  <option value="all">Semua game</option>
                  {catalog.games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
                <select
                  value={mappingFilter}
                  onChange={(event) => setMappingFilter(event.target.value)}
                >
                  <option value="all">Semua mapping</option>
                  <option value="ready">Siap</option>
                  <option value="mapped">Terpetakan</option>
                  <option value="unmapped">Belum terpetakan</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">Semua status</option>
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                  <option value="edited">Sedang diedit</option>
                </select>
                <select
                  value={marginFilter}
                  onChange={(event) => setMarginFilter(event.target.value)}
                >
                  <option value="all">Semua margin</option>
                  <option value="loss">Rugi (jual &lt; modal)</option>
                  <option value="thin">Margin tipis (&lt;5%)</option>
                  <option value="no-cost">Tanpa data modal</option>
                </select>
                <span className="acc-filter-count">
                  {filteredProducts.length} dari {catalog.products.length} produk
                </span>
              </div>

              {/*
                Alat penyesuaian harga DICIPAKAN, dan itu bagian yang
                paling penting dari perubahan ini.

                Tombol "Terapkan ke N terfilter" mengubah harga SELURUH
                hasil filter dalam satu klik. Sebelumnya ia berdiri di baris
                yang sama dengan kotak pencarian - level visual yang sama
                untuk "cari" dan "ubah harga 200 produk", hanya beda
                ketebalan huruf.

                Filter dipisah jadi barisnya sendiri supaya operator tahu
                garis batasnya: yang di bawah adalah semua produk, bukan
                hanya yang terlihat. Badge di judul panel membuat "ada
                yang belum disimpan" terlihat tanpa menggulir ke bawah.
              */}
              {catalog && (
                <div className="acc-module-summary">
                  <article>
                    <small>Total produk</small>
                    <strong>{filteredProducts.length}</strong>
                    <span>dari {catalog.stats.total} terdaftar</span>
                  </article>
                  <article>
                    <small>Aktif</small>
                    <strong>{filteredProducts.filter((p) => p.active).length}</strong>
                    <span>{filteredProducts.filter((p) => !p.active).length} draft</span>
                  </article>
                  <article>
                    <small>Tanpa harga modal</small>
                    <strong>{filteredProducts.filter((p) => p.cheapestCost === null).length}</strong>
                    <span>tidak bisa dihitung margin</span>
                  </article>
                  <article>
                    <small>Margin rugi</small>
                    <strong>
                      {
                        filteredProducts.filter((p) => {
                          const info = marginOf(
                            p,
                            Number(drafts[p.id]?.sellingPrice ?? p.sellingPrice),
                          );
                          return info !== null && info.margin < 0;
                        }).length
                      }
                    </strong>
                    <span>jual di bawah modal termurah</span>
                  </article>
                </div>
              )}

              <CollapsiblePanel
                title="Alat harga massal"
                description={`Menyentuh ${filteredProducts.length} produk hasil filter saat ini. Tombol ini mengubah harga semuanya sekaligus.`}
                badge={dirtyProductCount > 0 ? `${dirtyProductCount} belum disimpan` : null}
                defaultOpen={dirtyProductCount > 0}
              >
                <div className="acc-bulk-adjust">
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="0.5"
                    value={bulkPercent}
                    onChange={(event) => setBulkPercent(event.target.value)}
                    aria-label="Persen penyesuaian harga"
                  />
                  <span>%</span>
                  <button
                    type="button"
                    onClick={applyBulkPercent}
                    disabled={Boolean(busy) || filteredProducts.length === 0}
                  >
                    Terapkan ke {filteredProducts.length} terfilter
                  </button>
                </div>
                <div className="acc-bulk-adjust" title="Parameter harga saran dari modal supplier">
                  <span>Saran</span>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="0.5"
                    value={suggestPercent}
                    onChange={(event) => setSuggestPercent(event.target.value)}
                    aria-label="Mark-up jual saran persen"
                  />
                  <span>%</span>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="0.5"
                    value={suggestRefPercent}
                    onChange={(event) => setSuggestRefPercent(event.target.value)}
                    aria-label="Mark-up coret saran persen"
                  />
                  <span>%</span>
                </div>
                <div className="acc-action-panel">
                  <button
                    className="admin-save-button acc-save-all"
                    type="button"
                    disabled={Boolean(busy) || dirtyProductCount === 0}
                    onClick={() => void saveAllDirty()}
                  >
                    {busy === "save-all"
                      ? "Menyimpan..."
                      : `Simpan semua (${dirtyProductCount})`}
                  </button>
                </div>
              </CollapsiblePanel>

              <div className="admin-catalog-card acc-catalog-card">
                <div className="admin-table-head">
                  <span>Produk</span>
                  <span>Harga ${BRAND.shortName}</span>
                  <span>Digiflazz</span>
                  <span>Melostore</span>
                  <span>Aksi</span>
                </div>
                <div className="admin-product-list">
                  {katalogBaris.map((product) => {
                    const draft = drafts[product.id] ?? draftFromProduct(product);
                    const saving = busy === `save:${product.id}`;
                    const dirty = isDraftDirty(product, draft);
                    const sellingValue = Number(draft.sellingPrice);
                    const referenceValue = Number(draft.referencePrice);
                    const margin = marginOf(product, sellingValue);
                    const priceError =
                      Number.isFinite(sellingValue) &&
                      Number.isFinite(referenceValue) &&
                      referenceValue < sellingValue;

                    /*
                     * SKU Melostore yang efektif tampil di baris ini.
                     *
                     * `melostorePick` diisi oleh muatKandidatSupplier, yang
                     * hanya berjalan saat masuk seksi katalog atau klik
                     * refresh - kalau state itu belum termuat, kolom
                     * Melostore menampilkan "Pilih SKU..." padahal mapping
                     * tersimpan ada. API katalog sudah membawa nilai
                     * tersimpannya (`product.melostore.sku`), jadi itu
                     * fallback-nya.
                     *
                     * `??` dan bukan `||`: pick "" berarti operator memilih
                     * "Kosongkan" - itu keputusan eksplisit dan TIDAK boleh
                     * ditimpa nilai tersimpan.
                     */
                    const skuTampil =
                      melostorePick[product.id] ?? product.melostore.sku ?? "";
                    const skuTersimpan =
                      melostoreTersimpan[product.id] ?? product.melostore.sku ?? "";

                    return (
                      <article
                        className={
                          "admin-product-row" + (dirty ? " admin-row-dirty" : "")
                        }
                        key={product.id}
                      >                                          {/*
                         * Tabel produk lima kolom (revamp).
                         *
                         * DUA PENYEBAB HALAMAN DULU MENGGANTUNG, keduanya
                         * hilang di sini:
                         *
                         * 1. Ribuan baris form dirender sekaligus. Sekarang
                         *    25 baris per halaman, sisanya di belakang
                         *    pagination.
                         *
                         * 2. Dropdown Melostore 7.000-an <option> per baris
                         *    = jutaan node DOM. Sekarang combobox pencarian:
                         *    kandidat dihitung per produk yang DIBUKA
                         *    lewat urutkanKandidatMelostore (Cocok + 
                         *    Mendekati), dan mengetik mencari seluruh
                         *    katalog dengan maksimal 30 hasil.
                         *
                         * Kolom Digiflazz tampil saja - pengubahan
                         * mappingnya lewat halaman Katalog Digiflazz yang
                         * punya alur publish sendiri.
                         */}
                        <div className="admin-product-main">
                          <small>
                            {product.gameShortName} · {product.label}
                          </small>
                          <div className="admin-internal-sku-row">
                            <input
                              className="admin-internal-sku-input"
                              value={draft.internalSku}
                              placeholder="SKU internal..."
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  internalSku: event.target.value.toUpperCase(),
                                })
                              }
                            />
                            {!draft.internalSku ? (
                              <button
                                type="button"
                                className="admin-internal-sku-buat"
                                title="Buat SKU internal otomatis dari game dan nama produk"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  updateDraft(product.id, {
                                    internalSku:
                                      generateInternalSku({
                                        gameId: product.gameId,
                                        label: draft.label,
                                      }) ?? "",
                                  })
                                }
                              >
                                Buat
                              </button>
                            ) : null}
                          </div>
                          <input
                            className="admin-inline-name"
                            value={draft.label}
                            onChange={(event) =>
                              updateDraft(product.id, {
                                label: event.target.value,
                              })
                            }
                          />
                          <input
                            className="admin-inline-note"
                            value={draft.note}
                            placeholder="Catatan produk"
                            onChange={(event) =>
                              updateDraft(product.id, {
                                note: event.target.value,
                              })
                            }
                          />
                          {!product.active && (
                            <span className="admin-draft-badge">Draft</span>
                          )}
                        </div>

                        <div className="admin-price-stack">
                          <div className="admin-price-fields">
                            <label>
                              <span>Harga jual</span>
                              <input
                                type="number"
                                value={draft.sellingPrice}
                                onChange={(event) =>
                                  updateDraft(product.id, {
                                    sellingPrice: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Harga coret</span>
                              <input
                                type="number"
                                value={draft.referencePrice}
                                onChange={(event) =>
                                  updateDraft(product.id, {
                                    referencePrice: event.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                          {/*
                           * Ubah harga cepat: menaikkan harga yang sedang
                           * diisi sebesar persennya. Persen 5/10/20 sesuai
                           * permintaan - perilaku sama dengan sebelum
                           * revamp, hanya daftar persennya yang disesuaikan.
                           */}
                          <div className="admin-quick-price">
                            {[5, 10, 20].map((percent) => (
                              <button
                                key={percent}
                                type="button"
                                onClick={() => adjustDraftPrice(product, percent)}
                              >
                                +{percent}%
                              </button>
                            ))}
                          </div>
                          {priceError && (
                            <span className="admin-price-hint">
                              Harga coret lebih kecil dari harga jual.
                            </span>
                          )}
                          {margin && (
                            <div
                              className={
                                "admin-margin-line " +
                                (margin.margin < 0
                                  ? "negative"
                                  : margin.percent < 5
                                    ? "thin"
                                    : "positive")
                              }
                            >
                              <span>Margin</span>
                              <strong>
                                {margin.margin >= 0 ? "+" : ""}
                                {formatIDR(margin.margin)} (
                                {margin.percent.toFixed(1)}%)
                              </strong>
                            </div>
                          )}
                        </div>

                        <div className="admin-supplier-cell">
                          <small className="admin-supplier-name">Digiflazz</small>
                          {product.supplier.sku ? (
                            <>
                              <code className="admin-sku-supplier">
                                {product.supplier.sku}
                              </code>
                              <strong className="admin-cost-line">
                                {formatIDR(product.supplier.cost ?? 0)}
                              </strong>
                              {marginDariModal(
                                product.supplier.cost,
                                sellingValue,
                              ) ? (
                                <small className="admin-margin-supplier">
                                  Margin 
                                  {(() => {
                                    const info = marginDariModal(
                                      product.supplier.cost,
                                      sellingValue,
                                    );
                                    return info === null
                                      ? "-"
                                      : `${info.margin >= 0 ? "+" : ""}${formatIDR(info.margin)} (${info.percent.toFixed(1)}%)`;
                                  })()}
                                </small>
                              ) : null}
                              <small
                                className={
                                  product.supplier.ready
                                    ? "admin-supplier-ready"
                                    : "admin-supplier-warning"
                                }
                              >
                                {product.supplier.ready
                                  ? "Siap dijual"
                                  : "Mapped, supplier tidak aktif"}
                              </small>
                            </>
                          ) : (
                            <small className="admin-supplier-warning">
                              Belum dipetakan
                            </small>
                          )}
                        </div>

                        <div className="admin-supplier-cell">
                          <small className="admin-supplier-name">Melostore</small>
                          {melostoreTerbuka[product.id] ? (
                            <div className="admin-sku-combo">
                              <input
                                autoFocus
                                value={melostoreCari[product.id] ?? ""}
                                placeholder="Cari SKU atau nama..."
                                onChange={(event) =>
                                  setMelostoreCari((current) => ({
                                    ...current,
                                    [product.id]: event.target.value,
                                  }))
                                }
                              />
                              <div className="admin-sku-combo-list">
                                {(() => {
                                  const teks = (melostoreCari[product.id] ?? "")
                                    .trim()
                                    .toLowerCase();

                                  /*
                                   * Identitas game produk ini baris - dipakai
                                   * saran DAN hasil ketik, supaya SKU game lain
                                   * tidak pernah ditawarkan lewat jalur mana pun.
                                   */
                                  const identitasProduk = {
                                    gameId: product.gameId,
                                    gameName: product.gameName,
                                    gameShortName: product.gameShortName,
                                    label: draft.label,
                                  };

                                  /*
                                   * Tanpa ketik: saran per produk (Cocok +
                                   * Mendekati) - nominal sama dan game sama
                                   * (prefiks, atau brand untuk game tanpa
                                   * prefiks). Dengan ketik: cari katalog
                                   * penuh TETAPI tetap disaring game yang sama -
                                   * pencarian manual bukan pintu masuk barang
                                   * game salah.
                                   */
                                  const kandidat = teks
                                    ? supplierCatalog.melostore
                                        .filter((item) =>
                                          gameCocokUntukProduk(identitasProduk, item),
                                        )
                                        .filter(
                                          (item) =>
                                            item.sku.toLowerCase().includes(teks) ||
                                            item.name.toLowerCase().includes(teks),
                                        )
                                        .map((item) => ({
                                          ...item,
                                          exact: false,
                                          sameGame: false,
                                          sameNominal: false,
                                          region: null,
                                        }))
                                        .slice(0, 30)
                                    : gabungkanKandidat(
                                        urutkanKandidatMelostore(
                                          identitasProduk,
                                          supplierCatalog.melostore.map(
                                            (item) => ({
                                              ...item,
                                              exact: false,
                                              sameGame: false,
                                              sameNominal: false,
                                              region: null,
                                            }),
                                          ),
                                        ),
                                      );

                                  if (kandidat.length === 0) {
                                    return (
                                      <small className="admin-sku-combo-kosong">
                                        {teks
                                          ? "Tidak ada SKU game ini yang cocok dengan pencarian."
                                          : "Tidak ada kandidat nominal sama untuk game ini - ketik untuk mencari manual."}
                                      </small>
                                    );
                                  }

                                  return kandidat.map((item) => (
                                    <button
                                      key={item.sku}
                                      type="button"
                                      className={
                                        "admin-sku-combo-item" +
                                        (item.exact ? " exact" : "")
                                      }
                                      onClick={() => {
                                        updateDraft(product.id, {});
                                        setMelostorePick((current) => ({
                                          ...current,
                                          [product.id]: item.sku,
                                        }));
                                        setMelostoreTerbuka((current) => ({
                                          ...current,
                                          [product.id]: false,
                                        }));
                                        setMelostoreCari((current) => {
                                          const next = { ...current };
                                          delete next[product.id];
                                          return next;
                                        });
                                      }}
                                    >
                                      <span className="admin-sku-combo-sku">
                                        {item.sku}
                                        {item.region ? ` (${item.region})` : ""}
                                      </span>
                                      <span className="admin-sku-combo-nama">
                                        {item.name} - {formatIDR(item.cost)}
                                      </span>
                                    </button>
                                  ));
                                })()}
                                <button
                                  type="button"
                                  className="admin-sku-combo-item kosong"
                                  onClick={() => {
                                    updateDraft(product.id, {});
                                    setMelostorePick((current) => ({
                                      ...current,
                                      [product.id]: "",
                                    }));
                                    setMelostoreTerbuka((current) => ({
                                      ...current,
                                      [product.id]: false,
                                    }));
                                  }}
                                >
                                  <span className="admin-sku-combo-sku">
                                    Kosongkan
                                  </span>
                                  <span className="admin-sku-combo-nama">
                                    Hanya memakai Digiflazz
                                  </span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="admin-sku-combo-trigger"
                              onClick={() =>
                                setMelostoreTerbuka((current) => ({
                                  ...current,
                                  [product.id]: true,
                                }))
                              }
                            >
                              {skuTampil || "Pilih SKU Melostore..."}
                            </button>
                          )}
                          {skuTampil && product.melostore.cost !== null ? (
                            (() => {
                              const info = marginDariModal(
                                product.melostore.cost,
                                sellingValue,
                              );
                              return info === null ? null : (
                                <small className="admin-margin-supplier">
                                  Margin 
                                  {`${info.margin >= 0 ? "+" : ""}${formatIDR(info.margin)} (${info.percent.toFixed(1)}%)`}
                                </small>
                              );
                            })()
                          ) : null}
                          {skuTampil !== skuTersimpan && (
                            <small className="admin-supplier-warning">
                              Belum disimpan - tekan Simpan.
                            </small>
                          )}
                        </div>

                        <div className="admin-status-cell">
                          <label className="admin-toggle">
                            <input
                              type="checkbox"
                              checked={draft.active}
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  active: event.target.checked,
                                })
                              }
                            />
                            <span>{draft.active ? "Aktif" : "Draft"}</span>
                          </label>
                          {draft.active ? (
                            <small className="admin-supplier-ready">
                              Terlihat pelanggan
                            </small>
                          ) : (
                            <small className="admin-supplier-warning">
                              Belum terlihat pelanggan
                            </small>
                          )}
                        </div>

                        <div className="admin-actions-column">
                          <button
                            type="button"
                            className="admin-reset-button"
                            disabled={
                              Boolean(busy) || product.cheapestCost === null
                            }
                            title="Hitung ulang harga jual & coret dari modal supplier termurah (pakai persen Saran)"
                            onClick={() => resetHargaKeSupplier(product)}
                          >
                            Reset harga
                          </button>
                          <button
                            type="button"
                            className="admin-reset-button"
                            disabled={Boolean(busy) || !dirty}
                            onClick={() => resetDraft(product)}
                          >
                            Buang
                          </button>
                          <button
                            className="admin-save-button"
                            type="button"
                            disabled={Boolean(busy) || (!dirty && melostorePick[product.id] === (melostoreTersimpan[product.id] ?? ""))}
                            onClick={() => void simpanBarisKatalog(product)}
                          >
                            {saving ? "Saving..." : "Simpan"}
                          </button>
                          {/*
                           * Hapus permanen: hanya untuk produk yang MEMANG
                           * draft di database (product.active), bukan yang
                           * baru di-toggle di layar - backend akan menolak
                           * yang belum tersimpan, dan menampilkan tombol
                           * untuk produk aktif menggoda salah klik.
                           */}
                          {!product.active && (
                            <button
                              type="button"
                              className="admin-delete-button"
                              disabled={Boolean(busy)}
                              title="Hapus produk draft ini dari database permanen, beserta pemetaan suppliernya"
                              onClick={() => void hapusPermanenDraft(product)}
                            >
                              {busy === `delete:${product.id}` ? "Menghapus..." : "Hapus permanen"}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {filteredProducts.length > KATALOG_PER_HALAMAN ? (
                  <div className="acc-tx-pagination">
                    <button
                      type="button"
                      disabled={katalogHalaman <= 1}
                      onClick={() => setKatalogPage(katalogHalaman - 1)}
                    >
                      Sebelumnya
                    </button>
                    <span className="acc-tx-pageinfo">
                      Halaman {katalogHalaman} dari {katalogTotalHalaman} ({filteredProducts.length} produk)
                    </span>
                    <button
                      type="button"
                      disabled={katalogHalaman >= katalogTotalHalaman}
                      onClick={() => setKatalogPage(katalogHalaman + 1)}
                    >
                      Berikutnya
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}

          {section === "supplier" && catalog && (
            <>
              <SectionHead
                eyebrow="Supplier"
                title="Operasional Digiflazz"
                copy="Saldo, sync price list, mapping, dan automation supplier."
                action={
                  /*
                   * Dua supplier, satu tempat masuk.
                   *
                   * Digiflazz punya halaman katalog sendiri; Melostore
                   * baru punya pemetaan. Keduanya ditampilkan sejajar
                   * supaya operator tidak perlu menghafal di mana
                   * supplier mana dikelola.
                   */
                  <div className="acc-action-panel">
                    <Link className="acc-primary-link" href="/admin/digiflazz">
                      Buka supplier catalog →
                    </Link>
                    <Link className="acc-inline-button" href="/admin/melostore-mapping">
                      Pemetaan Melostore →
                    </Link>
                  </div>
                }
              />

              <div className="acc-metrics">
                <article>
                  <small>Saldo Digiflazz</small>
                  <strong>{formatIDR(catalog.balance.availableBalance)}</strong>
                  <span>{formatTime(catalog.balance.checkedAt)}</span>
                </article>
                {/*
                 * Supplier pembanding punya saldonya sendiri. Null bukan
                 * nol: baris supplier_balances belum ada karena "Perbarui
                 * saldo" belum pernah dijalankan.
                 */}
                <article>
                  <small>Saldo Melostore</small>
                  {catalog.balance.melostore ? (
                    <>
                      <strong>{formatIDR(catalog.balance.melostore.availableBalance)}</strong>
                      <span>{formatTime(catalog.balance.melostore.checkedAt)}</span>
                    </>
                  ) : (
                    <>
                      <strong>Belum disinkron</strong>
                      <span>Tekan "Perbarui saldo Melostore"</span>
                    </>
                  )}
                </article>
                <article>
                  <small>Siap dijual</small>
                  <strong>{catalog.stats.ready}</strong>
                  <span>{catalog.stats.mapped} terpetakan</span>
                </article>
                <article>
                  <small>Perlu mapping</small>
                  <strong>{catalog.stats.unmapped}</strong>
                  <span>Dari {catalog.stats.total} produk</span>
                </article>
              </div>

              <div className="acc-action-panel acc-supplier-actions">
                <SupplierActionButton
                  action="balance"
                  label="Cek saldo"
                  busyLabel="Memeriksa saldo..."
                  busy={busy}
                  state={actionStates.balance}
                  onClick={() => void checkBalance()}
                />
                <SupplierActionButton
                  action="melostore-balance"
                  label="Perbarui saldo Melostore"
                  busyLabel="Memeriksa saldo Melostore..."
                  busy={busy}
                  state={actionStates["melostore-balance"]}
                  onClick={() => void perbaruiSaldoMelostore()}
                />
                <SupplierActionButton
                  action="sync"
                  label="Sync harga supplier"
                  busyLabel="Sinkron harga..."
                  busy={busy}
                  state={actionStates.sync}
                  onClick={() => void syncPrices()}
                />
                <SupplierActionButton
                  action="scan"
                  label="Scan mapping"
                  busyLabel="Memindai..."
                  busy={busy}
                  state={actionStates.scan}
                  onClick={() => void runBootstrap(false)}
                />
                <SupplierActionButton
                  action="automap"
                  label="Sinkron ke Digiflazz"
                  busyLabel="Sinkron..."
                  busy={busy}
                  state={actionStates.automap}
                  onClick={() => void syncCatalogWithDigiflazz()}
                />
              </div>

              <AdminCatalogTools />
            </>
          )}

          {section === "receipts" && (
            <>
              {/*
               * Halaman ini sebelumnya bernama "Bukti Transfer" dengan
               * keterangan "Verifikasi bukti bayar", padahal isinya adalah
               * log pengiriman EMAIL. Tidak ada alur verifikasi pembayaran
               * manual di sistem ini - jadi nama lama tidak hanya
               * menyesatkan, tapi menjanjikan fitur yang memang tidak ada.
               *
               * Sekarang namanya sesuai isi. Kalau nanti memang butuh
               * verifikasi transfer manual, itu fitur BARU dan harus dibuat
               * terpisah, bukan disamarkan lewat nama menu.
               */}
              <SectionHead
                eyebrow="Operasional"
                title="Log pengiriman email"
                copy="Status pengiriman receipt ke user lewat Brevo. Bukan halaman verifikasi pembayaran."
              />

              <ReceiptPreview />

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Order</span>
                  <span>Penerima</span>
                  <span>Penyedia</span>
                  <span>Percobaan</span>
                  <span>Status</span>
                </div>
                {receipts.map((receipt) => (
                  <div className="acc-receipts-row" key={receipt.id}>
                    <div>
                      <strong>{receipt.orderId}</strong>
                      <span>{formatTime(receipt.createdAt)}</span>
                    </div>
                    <span>{receipt.recipient}</span>
                    <div>
                      <strong>{receipt.provider}</strong>
                      <span>
                        {receipt.providerMessageId
                          ? receipt.providerMessageId
                          : "Belum ada ID pesan"}
                      </span>
                    </div>
                    <strong>{receipt.attempts}</strong>
                    <div>
                      <span className={`acc-status receipt-${receipt.status}`}>
                        {RECEIPT_STATUS_LABEL[receipt.status] ??
                          receipt.status}
                      </span>
                      {receipt.lastError && (
                        <small className="acc-error-text">
                          {receipt.lastError}
                        </small>
                      )}
                    </div>
                  </div>
                ))}
                {receipts.length === 0 && (
                  <div className="acc-empty">
                    Belum ada log pengiriman email.
                  </div>
                )}
              </div>
            </>
          )}

          {section === "points" && pointsData && (
            <>
              <SectionHead
                eyebrow="Loyalitas"
                title="Lacte Points"
                copy="Outstanding liability, reservasi, lots FIFO, expiry, dan ledger points."
                action={
                  <button
                    className="acc-primary-link"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runPointsExpiry()}
                  >
                    {busy === "points-expiry" ? "Memproses..." : "Jalankan expiry"}
                  </button>
                }
              />

              <div className="acc-metrics">
                <article>
                  <small>Outstanding</small>
                  <strong>{pointsData.stats.outstanding.toLocaleString("id-ID")} pts</strong>
                  <span>≈ {formatIDR(pointsData.stats.outstanding * pointsData.rules.pointValueIdr)}</span>
                </article>
                <article>
                  <small>Tersedia</small>
                  <strong>{pointsData.stats.available.toLocaleString("id-ID")} pts</strong>
                  <span>{pointsData.stats.accounts} akun loyalty</span>
                </article>
                <article>
                  <small>Direservasi</small>
                  <strong>{pointsData.stats.reserved.toLocaleString("id-ID")} pts</strong>
                  <span>Pembayaran belum final</span>
                </article>
                <article>
                  <small>Total ditukar</small>
                  <strong>{pointsData.stats.lifetimeRedeemed.toLocaleString("id-ID")} pts</strong>
                  <span>Dari {pointsData.stats.lifetimeEarned.toLocaleString("id-ID")} terkumpul</span>
                </article>
              </div>

              <div className="acc-points-rules">
                <span>1 pt / {formatIDR(pointsData.rules.earnEveryIdr)}</span>
                <span>1 pt = {formatIDR(pointsData.rules.pointValueIdr)}</span>
                <span>Min. {pointsData.rules.minimumRedeem} pts</span>
                <span>Kelipatan {pointsData.rules.redeemStep} pts</span>
                <span>Maks {Math.round(pointsData.rules.maxRedeemRate * 100)}% subtotal</span>
              </div>

              <div className="acc-grid-two acc-points-grid">
                <div className="acc-table-card">
                  <div className="acc-points-head">
                    <span>User</span>
                    <span>Tersedia</span>
                    <span>Direservasi</span>
                  </div>
                  {pointsData.accounts.slice(0, 20).map((account) => (
                    <div className="acc-points-row" key={account.userId}>
                      <div>
                        <strong>{account.userId.slice(0, 8)}…</strong>
                        <small>{formatTime(account.updatedAt)}</small>
                      </div>
                      <strong>{account.available.toLocaleString("id-ID")} pts</strong>
                      <span>{account.reserved.toLocaleString("id-ID")} pts</span>
                    </div>
                  ))}
                  {pointsData.accounts.length === 0 && (
                    <div className="acc-empty">Belum ada loyalty account.</div>
                  )}
                </div>

                <div className="acc-table-card">
                  <div className="acc-points-ledger-head">
                    <span>Aktivitas terbaru</span>
                    <span>Delta</span>
                  </div>
                  {pointsData.ledger.slice(0, 25).map((entry) => (
                    <div className="acc-points-ledger-row" key={entry.id}>
                      <div>
                        <strong>{entry.type}</strong>
                        <small>
                          {entry.orderId ??
                            entry.userId.slice(0, 8) + "…"} · {formatTime(entry.createdAt)}
                        </small>
                      </div>
                      <b
                        className={
                          entry.pointsDelta > 0
                            ? "positive"
                            : entry.pointsDelta < 0
                              ? "negative"
                              : ""
                        }
                      >
                        {entry.pointsDelta !== 0
                          ? (entry.pointsDelta > 0 ? "+" : "") +
                            entry.pointsDelta.toLocaleString("id-ID")
                          : (entry.reservedDelta > 0 ? "+" : "") +
                            entry.reservedDelta.toLocaleString("id-ID") +
                            " res."}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === "merchants" && merchantData && (
            <>
              <SectionHead
                eyebrow="Keuangan"
                title="Toko ritel"
                copy="Buat toko, atur biaya layanan yang dibebankan ke pembeli, dan pantau piutang yang belum dilunasi. Biaya layanan dibayar langsung ke toko — Lacte tidak mengambil bagian dari nilai itu."
              />

              {!merchantData.retailEnabled ? (
                <div className="acc-warning-card">
                  Jalur checkout ritel masih dimatikan (MERCHANT_RETAIL_ENABLED tidak aktif).
                  Toko bisa dibuat, tapi pembeli tidak akan melihat metode pembayarannya.
                </div>
              ) : null}

              {issuedPin ? (
                <div className="acc-warning-card">
                  <strong>PIN kasir untuk {issuedPin.code}: {issuedPin.pin}</strong>
                  <p>{issuedPin.notice}</p>
                  <button
                    className="acc-ghost-link"
                    type="button"
                    onClick={() => setIssuedPin(null)}
                  >
                    Saya sudah mencatatnya
                  </button>
                </div>
              ) : null}

              <div className="acc-grid-two">
                <div className="acc-table-card">
                  <h3 className="acc-card-head">Daftar toko</h3>
                  {!merchantData.merchants.length ? (
                    <p className="acc-empty">Belum ada toko. Buat satu di samping.</p>
                  ) : (
                    <div className="acc-table-scroll">
                    <table className="acc-table">
                      <thead>
                        <tr>
                          <th>Toko</th>
                          <th>Fee</th>
                          <th>Termin</th>
                          <th>Piutang</th>
                          <th>Status</th>
                          <th>Pelunasan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merchantData.merchants.map((merchant) => (
                          <tr
                            key={merchant.id}
                            className="acc-row-link"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              setMerchantForm({
                                id: merchant.id,
                                name: merchant.name,
                                code: merchant.code,
                                serviceFeeFlatIdr: String(merchant.serviceFeeFlatIdr),
                                paymentTermDays: String(merchant.paymentTermDays),
                                status: merchant.status,
                                notes: merchant.notes ?? "",
                                resetPin: false,
                              });
                            }}
                            onClick={() =>
                              setMerchantForm({
                                id: merchant.id,
                                name: merchant.name,
                                code: merchant.code,
                                serviceFeeFlatIdr: String(merchant.serviceFeeFlatIdr),
                                paymentTermDays: String(merchant.paymentTermDays),
                                status: merchant.status,
                                notes: merchant.notes ?? "",
                                resetPin: false,
                              })
                            }
                          >
                            <td data-label="Toko">
                              <strong>{merchant.name}</strong>
                              <br />
                              <code>{merchant.code}</code>
                            </td>
                            <td data-label="Fee">
                              {/*
                               * Fee 0 ditampilkan sebagai "Belum diatur", bukan
                               * "Rp0".
                               *
                               * Bedanya penting: toko yang didaftarkan lewat
                               * `/merchant/register` mulai dengan fee 0 sampai
                               * admin mengaturnya. Kalau angka 0 ditampilkan
                               * apa adanya, admin mengira toko memang tanpa
                               * biaya - padahal itu settings yang belum diisi.
                               */
                              }
                              {merchant.serviceFeeFlatIdr > 0 ? (
                                formatIDR(merchant.serviceFeeFlatIdr)
                              ) : (
                                <span className="acc-merchant-overdue">
                                  Belum diatur
                                </span>
                              )}
                            </td>
                            <td data-label="Termin">{merchant.paymentTermDays} hari</td>
                            <td data-label="Piutang">
                              {formatIDR(merchant.outstanding)}
                              {merchant.overdueCount > 0 ? (
                                <>
                                  <br />
                                  <span className="acc-merchant-overdue">
                                    {merchant.overdueCount} lewat tenggat
                                  </span>
                                </>
                              ) : null}
                            </td>
                            <td data-label="Status">
                              <span
                                className={`acc-status ${merchantStatusClass(merchant.status)}`}
                              >
                                {MERCHANT_STATUS_LABEL[merchant.status] ??
                                  merchant.status}
                              </span>
                            </td>
                            <td data-label="Pelunasan">
                              {/*
                               * Tombol pelunasan sengaja TIDAK disable
                               * saat piutang nol. Merchant bisa transfer
                               * lebih besar dari piutang yang sedang
                               * berjalan, dan excess-nya jadi kredit yang
                               * mengurangi tagihan berikutnya - jadi ada
                               * kasus sah di mana nominal diisi 0.
                               */}
                              <button
                                type="button"
                                className="acc-btn"
                                onClick={() =>
                                  setMerchantPaymentForm({
                                    merchantId: merchant.id,
                                    merchantName: merchant.name,
                                    amount:
                                      merchant.outstanding > 0
                                        ? String(merchant.outstanding)
                                        : "",
                                    method: "transfer",
                                    reference: "",
                                    note: "",
                                  })
                                }
                              >
                                Catat pelunasan
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>

                {merchantPaymentForm?.merchantId ? (
                  <div className="acc-table-card acc-merchant-payment">
                    <h3 className="acc-card-head">
                      Catat pelunasan — {merchantPaymentForm.merchantName}
                    </h3>

                    {/*
                     * Sisa bayar adalah keadaan yang sah dan perlu
                     * dijelaskan di depan form, bukan Unexpected setelah
                     * menekan Simpan: admin akan mengira ada selisih
                     * tagihan yang belum ditemukan.
                     */}
                    <p className="acc-payment-hint">
                      Pembayaran dialokasikan otomatis ke tagihan paling lama
                      lebih dulu. Kalau nominal lebih besar dari piutang,
                      sisanya disimpan sebagai kredit toko dan mengurangi
                      tagihan berikutnya.
                    </p>

                    <label className="acc-field">
                      <span>Nominal diterima (Rp)</span>
                      <input
                        type="number"
                        step="100"
                        min="1"
                        value={merchantPaymentForm.amount}
                        onChange={(event) =>
                          setMerchantPaymentForm((current) =>
                            current
                              ? { ...current, amount: event.target.value }
                              : current,
                          )
                        }
                      />
                    </label>

                    <label className="acc-field">
                      <span>Metode</span>
                      <select
                        value={merchantPaymentForm.method}
                        onChange={(event) =>
                          setMerchantPaymentForm((current) =>
                            current
                              ? {
                                  ...current,
                                  method: event.target
                                    .value as MerchantPaymentForm["method"],
                                }
                              : current,
                          )
                        }
                      >
                        <option value="transfer">Transfer bank</option>
                        <option value="cash">Tunai</option>
                        <option value="other">Lainnya</option>
                      </select>
                    </label>

                    <label className="acc-field">
                      <span>Referensi (nomor transfer / nota)</span>
                      <input
                        value={merchantPaymentForm.reference}
                        onChange={(event) =>
                          setMerchantPaymentForm((current) =>
                            current
                              ? { ...current, reference: event.target.value }
                              : current,
                          )
                        }
                      />
                    </label>

                    <label className="acc-field">
                      <span>Catatan (opsional)</span>
                      <input
                        value={merchantPaymentForm.note}
                        onChange={(event) =>
                          setMerchantPaymentForm((current) =>
                            current
                              ? { ...current, note: event.target.value }
                              : current,
                          )
                        }
                      />
                    </label>

                    <div className="acc-actions-row">
                      <button
                        type="button"
                        className="acc-btn"
                        disabled={busy === "merchant-payment"}
                        onClick={recordMerchantPayment}
                      >
                        {busy === "merchant-payment"
                          ? "Menyimpan..."
                          : "Simpan pelunasan"}
                      </button>
                      <button
                        type="button"
                        className="acc-btn-danger"
                        onClick={() => setMerchantPaymentForm(null)}
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : null}

                <CollapsiblePanel
                  title={merchantForm?.id ? "Ubah toko" : "Buat toko"}
                  description="Nama, kode kasir, biaya layanan, dan termin pelunasan."
                  defaultOpen={Boolean(merchantForm)}
                >
                  <label className="acc-field">
                    <span>Nama toko</span>
                    <input
                      value={merchantForm?.name ?? ""}
                      disabled={Boolean(merchantForm?.id)}
                      onChange={(event) =>
                        setMerchantForm((current) =>
                          current
                            ? { ...current, name: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>

                  <label className="acc-field">
                    <span>Kode toko (4-16 huruf kapital/angka)</span>
                    <input
                      value={merchantForm?.code ?? ""}
                      disabled={Boolean(merchantForm?.id)}
                      onChange={(event) =>
                        setMerchantForm((current) =>
                          current
                            ? {
                                ...current,
                                code: event.target.value.toUpperCase(),
                              }
                            : current,
                        )
                      }
                    />
                  </label>

                  <label className="acc-field">
                    <span>Biaya layanan (Rp)</span>
                    <input
                      type="number"
                      step="100"
                      min="0"
                      value={merchantForm?.serviceFeeFlatIdr ?? ""}
                      onChange={(event) =>
                        setMerchantForm((current) =>
                          current
                            ? {
                                ...current,
                                serviceFeeFlatIdr: event.target.value,
                              }
                            : current,
                        )
                      }
                    />
                  </label>

                  <label className="acc-field">
                    <span>Termin pelunasan (hari)</span>
                    <input
                      type="number"
                      min="1"
                      max="90"
                      value={merchantForm?.paymentTermDays ?? ""}
                      onChange={(event) =>
                        setMerchantForm((current) =>
                          current
                            ? { ...current, paymentTermDays: event.target.value }
                            : current,
                        )
                      }
                    />
                  </label>

                  {merchantForm?.id ? (
                    <>
                      <label className="acc-field">
                        <span>Status</span>
                        <select
                          value={merchantForm.status}
                          onChange={(event) =>
                            setMerchantForm((current) =>
                              current
                                ? {
                                    ...current,
                                    status: event.target.value as MerchantForm["status"],
                                  }
                                : current,
                            )
                          }
                        >
                          <option value="active">Aktif</option>
                          <option value="pending">Menunggu persetujuan</option>
                          <option value="frozen">Dibekukan</option>
                          <option value="inactive">Nonaktif</option>
                        </select>
                      </label>

                      <label className="acc-checkbox-field">
                        <input
                          type="checkbox"
                          checked={merchantForm.resetPin}
                          onChange={(event) =>
                            setMerchantForm((current) =>
                              current
                                ? { ...current, resetPin: event.target.checked }
                                : current,
                            )
                          }
                        />
                        <span>Ganti PIN kasir (PIN baru ditampilkan sekali)</span>
                      </label>
                    </>
                  ) : null}

                  <div className="acc-actions-row">
                    <button
                      className="acc-primary-link"
                      type="button"
                      disabled={Boolean(busy) || !merchantForm}
                      onClick={() =>
                        void (merchantForm?.id ? updateMerchant() : createMerchant())
                      }
                    >
                      {merchantForm?.id ? "Simpan perubahan" : "Buat toko"}
                    </button>
                    {merchantForm?.id ? (
                      <button
                        className="acc-btn-danger"
                        type="button"
                        onClick={() => setMerchantForm(null)}
                      >
                        Batal
                      </button>
                    ) : null}
                  </div>
                </CollapsiblePanel>
              </div>
            </>
          )}

          {section === "finance" && (
            <>
              <SectionHead
                eyebrow="Keuangan"
                title="Rekonsiliasi keuangan"
                copy="Bandingkan frozen pricing, Midtrans, supplier cost, Points liability, dan affiliate ledger tanpa mengubah uang secara otomatis."
                action={
                  <button
                    className="acc-primary-link"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runFinanceReconciliation()}
                  >
                    {busy === "finance-reconcile"
                      ? "Memeriksa..."
                      : "Jalankan rekonsiliasi"}
                  </button>
                }
              />

              <div className="acc-metrics">
                <article>
                  <small>Diperiksa</small>
                  <strong>{financeData?.stats.checked ?? 0}</strong>
                  <span>Snapshot terbaru</span>
                </article>
                <article>
                  <small>Sesuai</small>
                  <strong>{financeData?.stats.ok ?? 0}</strong>
                  <span>Aturan keuangan cocok</span>
                </article>
                <article>
                  <small>Peringatan</small>
                  <strong>{financeData?.stats.warning ?? 0}</strong>
                  <span>Perlu ditinjau</span>
                </article>
                <article>
                  <small>Kesalahan</small>
                  <strong>{financeData?.stats.error ?? 0}</strong>
                  <span>Selisih penting</span>
                </article>
              </div>

              <div className="acc-table-card">
                <div className="acc-finance-head">
                  <span>Order</span>
                  <span>Diperiksa</span>
                  <span>Masalah</span>
                  <span>Hasil</span>
                </div>
                {(financeData?.rows ?? []).map((row) => (
                  <div className="acc-finance-row" key={row.orderId}>
                    <strong>{row.orderId}</strong>
                    <span>{formatTime(row.checkedAt)}</span>
                    <div>
                      {row.issues.length === 0 ? (
                        <span>No mismatch</span>
                      ) : (
                        row.issues.slice(0, 3).map((issue) => (
                          <small key={issue.code}>
                            {issue.code}: {issue.message}
                          </small>
                        ))
                      )}
                    </div>
                    <span className={"acc-status finance-" + row.result}>
                      {row.result}
                    </span>
                  </div>
                ))}
                {financeData && financeData.rows.length === 0 && (
                  <div className="acc-empty">
                    Belum ada financial reconciliation snapshot.
                  </div>
                )}
              </div>
            </>
          )}

          {section === "cashflow" && (
            <>
              <SectionHead
                eyebrow="Keuangan"
                title="Laporan arus kas"
                copy="Uang yang benar-benar bergerak lewat pembayaran langsung, dikurangi modal dan biaya. Jalur toko ritel dipisahkan: order-nya menambah piutang, dan uangnya baru masuk saat merchant mentransfer."
                action={
                  <button
                    className="acc-primary-link"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void downloadCashFlowCsv()}
                  >
                    {busy === "cashflow-csv" ? "Menyiapkan..." : "Unduh CSV"}
                  </button>
                }
              />

              {/*
                Kontrol periode.

                Preset plus rentang bebas, lewat komponen yang sama dengan
                laporan Transaksi. Keduanya memakai `resolveReportRange`
                yang sama di server, jadi "30 hari" berarti 30 hari yang
                sama di dua halaman - kalau masing-masing punya kendali
                sendiri, perbandingan antara dua laporan jadi tidak bermakna.
              */}
              <ReportRangePicker
                idPrefix="cashflow"
                presets={REPORT_PRESET_OPTIONS}
                busy={Boolean(busy)}
                value={cashFlowRange}
                onApply={(next) => {
                  setCashFlowRange(next);
                  void loadCashFlow(next).catch((error) =>
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Laporan arus kas gagal dimuat.",
                    ),
                  );
                }}
              />

              {/*
                Enam angka dalam dua kelompok.

                Kelompok pertama: uang yang benar-benar bergerak lewat
                pembayaran langsung. Kelompok kedua: jalur ritel, yang
                polanya berbeda - order-nya menambah piutang, bukan kas,
                dan uangnya baru masuk saat merchant mentransfer.

                Dipisah karena mencampur keduanya membuat kartu Omzet
                memuat angka yang belum jadi milik Lacte, dan membuat
                Transfer masuk kehilangan konteksnya.
              */}
              <div className="acc-metrics acc-metrics-three">
                <article>
                  <small>Omzet Lacte</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.grossRevenue ?? 0)}
                  </strong>
                  <span>
                    {cashFlowData?.totals.orders ?? 0} pesanan non-retail
                  </span>
                </article>
                <article>
                  <small>Biaya supplier</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.supplierCost ?? 0)}
                  </strong>
                  <span>modal fulfill, termasuk pesanan ritel</span>
                </article>
                <article>
                  <small>Margin Lacte</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.grossProfit ?? 0)}
                  </strong>
                  <span>
                    {cashFlowData?.totals.marginPercent ?? 0}% dari omzet
                  </span>
                </article>
              </div>

              {/*
               * Laba bersih = Margin Lacte.
               *
               * Satu-satunya jawaban yang dicari operator: "berapa
               * laba bersihku setelah semua?" Angka ini sama dengan
               * Margin Lacte karena margin SUDAH dikurangi diskon,
               * komisi afiliasi, biaya payment gateway, dan points.
               * Uang keluar pencairan afiliasi TIDAK dikurangkan lagi
               * - komisinya sudah terhitung di sini sejak order sukses.
               */}
              <div className="acc-metrics acc-metrics-three">
                <article>
                  <small>Laba bersih setelah semua</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.grossProfit ?? 0)}
                  </strong>
                  <span>
                    sudah termasuk diskon, komisi afiliasi, dan biaya
                    gateway - pencairan afiliasi tidak mengurangi lagi
                  </span>
                </article>
              </div>

              <div className="acc-metrics acc-metrics-three">
                <article>
                  <small>Piutang toko ritel</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.merchantReceivable ?? 0)}
                  </strong>
                  <span>
                    {cashFlowData?.totals.merchantOrders ?? 0} pesanan ritel
                  </span>
                </article>
                <article>
                  <small>Transfer masuk</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.merchantSettled ?? 0)}
                  </strong>
                  <span>dari pelunasan yang dicatat</span>
                </article>
                <article>
                  <small>Sisa piutang</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.merchantOutstanding ?? 0)}
                  </strong>
                  <span>
                    {(cashFlowData?.totals.merchantServiceFee ?? 0) > 0
                      ? `biaya layanan ${formatIDR(cashFlowData?.totals.merchantServiceFee ?? 0)} ikut di sini`
                      : "belum dilunasi merchant"}
                  </span>
                </article>
              </div>

              {cashFlowData ? (
                <>
                  {/*
                   * Grafik batang omzet harian.
                   *
                   * SVG inline, bukan chart library: satu seri, satu
                   *sumbu, dan datanya sudah di server. Chart library akan
                   * menambah ratusan kilobyte untuk sesuatu yang bisa
                   * dirender 30 baris SVG.
                   */}
                  <div className="acc-table-card">
                    <div className="acc-card-head">Omzet harian</div>
                    <CashFlowChart
                      days={cashFlowData.days}
                      profit={cashFlowData.totals.grossProfit}
                    />
                  </div>

                  {/*
                   * Catatan kas harian.
                   *
                   * Chart di atas cuma menunjukkan satu angka (omzet). Untuk
                   * "Uang masuk hari ini dari mana, uang keluar untuk apa"
                   * chart itu tidak menjawab apa pun - jadi tabel ini yang
                   * memuat jawabannya, dengan setiap kolom dinamai setelah
                   * sumber dan tujuannya.
                   *
                   * Kolom dikelompokkan dua: yang MEMASUK dari rekening, dan
                   * yang KELUAR dari rekening. Biaya layanan toko tidak ada
                   * di kolom mana pun karena uangnya dibayar pengguna
                   * langsung ke merchant dan tak pernah melewati Lacte.
                   */}
                  <div className="acc-table-card">
                    <div className="acc-card-head acc-cashflow-note-head">
                      <span>Catatan kas harian</span>
                      <small className="acc-card-head-note">
                        uang masuk dan keluar per hari
                      </small>
                    </div>

                    {/*
                     * Ringkasan di atas tabel.
                     *
                     * Tabel delapan kolom harus digulir dan dipindai baris per
                     * baris untuk menjawab "berapa yang masuk, berapa yang
                     * keluar, jadi berapa". Tiga angka itu diletakkan dulu
                     * karena itu pertanyaan yang sebenarnya dicari.
                     */}
                    <div className="acc-cash-summary">
                      <article>
                        <small>Masuk</small>
                        <strong className="acc-net-positive">
                          {formatIDR(cashFlowData.totals.cashIn)}
                        </strong>
                      </article>
                      <article>
                        <small>Keluar</small>
                        <strong>{formatIDR(cashFlowData.totals.cashOut)}</strong>
                      </article>
                      <article>
                        <small>Selisih</small>
                        <strong
                          className={
                            cashFlowData.totals.netCash < 0
                              ? "acc-net-negative"
                              : "acc-net-positive"
                          }
                        >
                          {formatIDR(cashFlowData.totals.netCash)}
                        </strong>
                      </article>
                    </div>

                    <div className="acc-table-scroll">
                      <table className="acc-table acc-table-money">
                        <thead>
                          <tr>
                            <th>Tanggal</th>
                            <th className="acc-num">Pesanan</th>
                            <th className="acc-num">Masuk: pembayaran</th>
                            <th className="acc-num">Masuk: pelunasan toko</th>
                            <th className="acc-num">Keluar: modal supplier</th>
                            <th className="acc-num">Keluar: pencairan</th>
                            <th className="acc-num">Keluar: fee gateway</th>
                            <th className="acc-num">Selisih</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashFlowDayRows.map((day) => (
                            <tr key={day.date}>
                              <td data-label="Tanggal">
                                <strong>
                                  {formatWibDayLabel(day.date)}
                                </strong>
                              </td>
                              <td className="acc-num" data-label="Pesanan">
                                {day.orders}
                              </td>
                              <td className="acc-num" data-label="Masuk: pembayaran">
                                {formatIDR(day.grossRevenue)}
                              </td>
                              <td
                                className="acc-num"
                                data-label="Masuk: pelunasan toko"
                              >
                                {formatIDR(day.merchantSettled)}
                              </td>
                              <td
                                className="acc-num"
                                data-label="Keluar: modal supplier"
                              >
                                {formatIDR(day.supplierCost)}
                              </td>
                              <td className="acc-num" data-label="Keluar: pencairan">
                                {formatIDR(day.affiliatePaidOut)}
                              </td>
                              <td
                                className="acc-num"
                                data-label="Keluar: fee gateway"
                              >
                                {formatIDR(day.gatewayFee)}
                              </td>
                              <td className="acc-num" data-label="Selisih">
                                <span
                                  className={
                                    day.netCash < 0
                                      ? "acc-net-negative"
                                      : "acc-net-positive"
                                  }
                                >
                                  {formatIDR(day.netCash)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td>TOTAL</td>
                            <td className="acc-num">{cashFlowData.totals.orders}</td>
                            <td className="acc-num">
                              {formatIDR(cashFlowData.totals.grossRevenue)}
                            </td>
                            <td className="acc-num">
                              {formatIDR(cashFlowData.totals.merchantSettled)}
                            </td>
                            <td className="acc-num">
                              {formatIDR(cashFlowData.totals.supplierCost)}
                            </td>
                            <td className="acc-num">
                              {formatIDR(cashFlowData.totals.affiliatePaidOut)}
                            </td>
                            <td className="acc-num">
                              {formatIDR(cashFlowData.totals.gatewayFee)}
                            </td>
                            <td className="acc-num">
                              <span
                                className={
                                  cashFlowData.totals.netCash < 0
                                    ? "acc-net-negative"
                                    : "acc-net-positive"
                                }
                              >
                                {formatIDR(cashFlowData.totals.netCash)}
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {cashFlowDaysDescending.length === 0 ? (
                      <div className="acc-empty">
                        Belum ada transaksi pada periode ini.
                      </div>
                    ) : null}

                    {cashFlowDayPageCount > 1 ? (
                      <div className="acc-tx-pagination">
                        <span>
                          Menampilkan{" "}
                          {safeCashFlowDayPage * CASH_DAYS_PER_PAGE + 1}-
                          {Math.min(
                            (safeCashFlowDayPage + 1) * CASH_DAYS_PER_PAGE,
                            cashFlowDaysDescending.length,
                          )}{" "}
                          dari {cashFlowDaysDescending.length} hari
                        </span>
                        <div>
                          <button
                            type="button"
                            disabled={safeCashFlowDayPage === 0}
                            onClick={() =>
                              setCashFlowDayPage(
                                Math.max(0, safeCashFlowDayPage - 1),
                              )
                            }
                          >
                            Sebelumnya
                          </button>
                          <span className="acc-tx-pageinfo">
                            {safeCashFlowDayPage + 1} / {cashFlowDayPageCount}
                          </span>
                          <button
                            type="button"
                            disabled={safeCashFlowDayPage >= cashFlowDayPageCount - 1}
                            onClick={() =>
                              setCashFlowDayPage(
                                Math.min(
                                  cashFlowDayPageCount - 1,
                                  safeCashFlowDayPage + 1,
                                ),
                              )
                            }
                          >
                            Berikutnya
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {hiddenCashFlowDayCount > 0 ? (
                      <p className="acc-table-note">
                        {hiddenCashFlowDayCount} hari tanpa transaksi
                        disembunyikan. Baris TOTAL tetap mencakup seluruh
                        periode.
                      </p>
                    ) : null}

                    <p className="acc-table-note">
                      Urutan baris terbaru di atas. "Masuk: pembayaran" adalah
                      QRIS, VA, dan e-Wallet dari pembeli; "Masuk: pelunasan
                      toko" adalah transfer dari toko ritel yang dicatat di
                      Toko ritel. "Keluar: modal supplier" termasuk untuk
                      order ritel - barangnya sudah dikirim meski uangnya
                      masih ditunggu dari toko, jadi hari dengan order ritel
                      besar bisa punya Selisih negatif. Biaya layanan toko
                      tidak masuk kolom mana pun: dibayar pembeli langsung ke
                      toko, tidak pernah melewati Lacte.
                    </p>
                  </div>

                  <div className="acc-grid-two">
                    <div className="acc-table-card">
                      <div className="acc-card-head">
                        Rincian per metode pembayaran
                      </div>
                      <div className="acc-table-scroll">
                        <table className="acc-table">
                          <thead>
                            <tr>
                              <th>Metode</th>
                              <th>Pesanan</th>
                              <th>Omzet</th>
                              <th>Biaya</th>
                              <th>Margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashFlowData.byMethod.map((method) => (
                              <tr key={method.paymentMethodId}>
                                <td data-label="Metode">
                                  {method.paymentMethodId}
                                </td>
                                <td data-label="Pesanan">{method.orders}</td>
                                <td data-label="Omzet">
                                  {formatIDR(method.revenue)}
                                </td>
                                <td data-label="Biaya">
                                  {formatIDR(method.supplierCost)}
                                </td>
                                <td data-label="Margin">
                                  {formatIDR(method.profit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {cashFlowData.byMethod.length === 0 ? (
                        <div className="acc-empty">
                          Belum ada transaksi pada periode ini.
                        </div>
                      ) : null}
                    </div>

                    {/*
                     * Pengurang pendapatan.
                     *
                     * Yang mengurangi omzet: diskon dan komisi. Fee
                     * layanan merchant TIDAK ikut di sini - itu bukan
                     * biaya Lacte, tapi uang yang dikumpulkan lalu
                     * diteruskan ke merchant. Memasukkannya ke daftar
                     * "biaya" membuatnya terlihat seperti pengeluaran Lacte,
                     * padahal uangnya lewat tangan tanpa tersentuh.Angka
                     * ini pindah ke panel piutang, di tempat yang benar-benar
                     * menjelaskan perannya.
                     */}
                    <div className="acc-table-card">
                      <div className="acc-card-head acc-cashflow-note-head">
                        Pengurang pendapatan
                      </div>
                      <div className="acc-cost-list">
                        <div>
                          <span>Diskon (promo, poin, referral)</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.discounts)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            Komisi affiliate{" "}
                            <small className="acc-form-notice">
                              (terjadi saat order sukses; margin Lacte di atas
                              sudah dikurangi angka ini)
                            </small>
                          </span>
                          <strong>
                            {formatIDR(
                              cashFlowData.totals.affiliateCommission,
                            )}
                          </strong>
                        </div>
                        <div className="acc-cost-total">
                          <span>Total pengurang</span>
                          <strong>
                            {formatIDR(
                              cashFlowData.totals.discounts +
                                cashFlowData.totals.affiliateCommission,
                            )}
                          </strong>
                        </div>
                        {cashFlowData.totals.failedOrders > 0 ? (
                          <div>
                            <span>Pesanan gagal (tidak masuk omzet)</span>
                            <strong>
                              {cashFlowData.totals.failedOrders}
                            </strong>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/*
                     * Uang keluar nyata dari rekening Lacte.
                     *
                     * PENTING: angka ini TIDAK boleh dikurangkan lagi
                     * dari margin. Komisinya sudah terhitung sebagai
                     * pengurang pendapatan saat order sukses; pencairan
                     * hanyalah pemindahan kas dari beban yang sudah
                     * tercatat. Mengurangkannya lagi dari margin berarti
                     * memotong komisi yang sama dua kali.
                     */}
                    <div className="acc-table-card">
                      <div className="acc-card-head acc-cashflow-note-head">
                        <span>Uang keluar</span>
                        <small className="acc-card-head-note">
                          pencairan komisi afiliasi
                        </small>
                      </div>
                      <div className="acc-cost-list">
                        <div>
                          <span>
                            Pencairan komisi afiliasi (
                            {cashFlowData.totals.affiliatePaidCount} lunas)
                          </span>
                          <strong>
                            {formatIDR(cashFlowData.totals.affiliatePaidOut)}
                          </strong>
                        </div>
                        {cashFlowData.affiliateApprovedPending > 0 ? (
                          <div>
                            <span>
                              Di-ACC, belum ditransfer (
                              {cashFlowData.affiliateApprovedPendingCount}
                              pencairan) - belum keluar
                            </span>
                            <strong>
                              {formatIDR(
                                cashFlowData.affiliateApprovedPending,
                              )}
                            </strong>
                          </div>
                        ) : null}
                        <div className="acc-cost-total">
                          <span>Total keluar periode ini</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.affiliatePaidOut)}
                          </strong>
                        </div>
                        <div>
                          <small className="acc-form-notice">
                            Angka ini adalah kas yang pindah ke rekening
                            partner - komisinya sudah terhitung sebagai
                            pengurang di margin Lacte. Jangan kurangkan
                            lagi dari margin, itu double-count.
                          </small>
                        </div>
                      </div>
                    </div>

                    {/*
                     * Piutang toko ritel.
                     *
                     * Dulu ini kotak kecil di bawah "Rincian biaya",
                     * terpisah dari tiga kartu metrik di atas yang
                     * menampilkan angka yang sama persis. Satu layar, tiga
                     * angka yang sama dua kali - yang bawah terlihat seperti
                     * catatan kaki padahal bukan.
                     *
                     * Sekarang jadi satu kartu dengan judul sendiri, dan
                     * jarak antar barisnya sama dengan daftar lain.
                     */}
                    <div className="acc-table-card acc-retail-panel">
                      <div className="acc-card-head">
                        <span>Posisi piutang toko ritel</span>
                        <small className="acc-card-head-note">
                          bukan kas masuk
                        </small>
                      </div>
                      <div className="acc-cost-list">
                        <div>
                          <span>
                            Piutang dari {cashFlowData.totals.merchantOrders} pesanan
                          </span>
                          <strong>
                            {formatIDR(cashFlowData.totals.merchantReceivable)}
                          </strong>
                        </div>
                        <div>
                          <span>Sudah ditransfer ke toko</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.merchantSettled)}
                          </strong>
                        </div>
                        <div className="acc-cost-total">
                          <span>
                            {cashFlowData.totals.merchantOutstanding < 0
                              ? "Sisa bayar (kredit toko)"
                              : "Masih terutang"}
                          </span>
                          <strong>
                            {formatIDR(
                              Math.abs(cashFlowData.totals.merchantOutstanding),
                            )}
                          </strong>
                        </div>
                        <div>
                          <span>
                            Biaya layanan merchant{" "}
                            <small>(diteruskan ke toko)</small>
                          </span>
                          <strong>
                            {formatIDR(
                              cashFlowData.totals.merchantServiceFee,
                            )}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="acc-empty">Memuat laporan arus kas...</div>
              )}
            </>
          )}

          {section === "transactions" && (
            <>
              <SectionHead
                eyebrow="Keuangan"
                title="Laporan transaksi"
                copy="Detail tiap transaksi: item yang dibeli, harga supplier, harga jual, dan margin Lacte. Harga katalog, harga jual, dan harga final sengaja ditampilkan terpisah karena ketiganya berbeda."
                action={
                  <button
                    className="acc-primary-link"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void downloadTransactionsCsv()}
                  >
                    {busy === "tx-csv" ? "Menyiapkan..." : "Unduh CSV"}
                  </button>
                }
              />

              {/*
               * Panel filter.
               *
               * Preset dan rentang bebas saling menyembunyikan: memilih
               * preset mengisi rentang bebas, jadi admin bisa langsung
               * menyempurnakan tanggalnya tanpa mengetik ulang.
               */}
              <div className="acc-table-card acc-tx-filters">
                <div className="acc-tx-filter-row">
                  <ReportRangePicker
                    idPrefix="tx"
                    presets={REPORT_PRESET_OPTIONS}
                    busy={Boolean(busy)}
                    value={txRange}
                    onApply={(next) => {
                      setTxRange(next);
                      setTxOffset(0);
                      /*
                       * `next` diteruskan eksplisit. Tanpa itu, yang
                       * terkirim adalah `txRange` dari render
                       * sebelumnya, karena `setTxRange` baru berlaku
                       * setelah render berikutnya.
                       */
                      void loadTransactions({ offset: 0 }, next).catch((error) =>
                        setNotice(
                          error instanceof Error
                            ? error.message
                            : "Laporan transaksi gagal dimuat.",
                        ),
                      );
                    }}
                  />

                  <label className="acc-field acc-tx-search">
                    <span>Cari (id order, game, item, atau akun)</span>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        setTxAppliedQuery(txQuery);
                        setTxOffset(0);
                        void loadTransactions({ offset: 0 }).catch((error) =>
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Laporan transaksi gagal dimuat.",
                          ),
                        );
                      }}
                    >
                      <input
                        value={txQuery}
                        placeholder="mis. NBH-2026 atau Google Play"
                        onChange={(event) => setTxQuery(event.target.value)}
                      />
                      <button type="submit">Cari</button>
                    </form>
                  </label>
                </div>

                <div className="acc-tx-filter-row">
                  <label className="acc-field">
                    <span>Status</span>
                    <select
                      value={txStatus}
                      onChange={(event) => {
                        const next = event.target.value;
                        setTxStatus(next);
                        setTxOffset(0);
                        void loadTransactions({ offset: 0 }).catch((error) =>
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Laporan transaksi gagal dimuat.",
                          ),
                        );
                      }}
                    >
                      <option value="">Semua status</option>
                      <option value="success">Selesai</option>
                      <option value="processing">Diproses</option>
                      <option value="pending_payment">Menunggu bayar</option>
                      <option value="pending_merchant">Menunggu scan</option>
                      <option value="failed">Gagal</option>
                      <option value="cancelled">Batal</option>
                    </select>
                  </label>

                  <label className="acc-field">
                    <span>Metode pembayaran</span>
                    <select
                      value={txPayment}
                      onChange={(event) => {
                        const next = event.target.value;
                        setTxPayment(next);
                        setTxOffset(0);
                        void loadTransactions({ offset: 0 }).catch((error) =>
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Laporan transaksi gagal dimuat.",
                          ),
                        );
                      }}
                    >
                      <option value="">Semua metode</option>
                      <option value="qris">QRIS</option>
                      <option value="ewallet">E-Wallet</option>
                      <option value="va">Virtual Account</option>
                      <option value="merchant_retail">Toko Ritel</option>
                    </select>
                  </label>
                </div>
              </div>

              {txReport ? (
                <>
                  {/*
                   * Ringkasan dihitung dari SELURUH baris terfilter,
                   * bukan dari halaman yang sedang tampil. Kalau tidak,
                   * total akan berubah-ubah tiap pindah halaman dan itu
                   * terbaca sebagai omzet naik-turun sendiri.
                   */}
                  <div className="acc-metrics">
                    <article>
                      <small>Transaksi</small>
                      <strong>{txReport.summary.count}</strong>
                      <span>
                        {txReport.summary.merchantUnpaidCount > 0
                          ? `${txReport.summary.merchantUnpaidCount} ritel belum dibayar`
                          : txReport.summary.excludedCount > 0
                            ? `${txReport.summary.excludedCount} tidak dihitung`
                            : "Semua selesai"}
                      </span>
                    </article>
                    <article>
                      <small>Omzet Lacte</small>
                      <strong>
                        {formatIDR(txReport.summary.grossRevenue)}
                      </strong>
                      <span>
                        {txReport.summary.merchantUnpaidRevenue > 0
                          ? `${formatIDR(txReport.summary.merchantUnpaidRevenue)} ritel menunggu transfer merchant - belum dihitung`
                          : txReport.summary.merchantServiceFee > 0
                            ? `sudah dikurangi biaya layanan merchant ${formatIDR(txReport.summary.merchantServiceFee)}`
                            : "harga final dikurangi biaya layanan toko"}
                      </span>
                    </article>
                    <article>
                      <small>Harga supplier</small>
                      <strong>
                        {formatIDR(txReport.summary.supplierCost)}
                      </strong>
                      <span>Total modal</span>
                    </article>
                    <article>
                      <small>Margin Lacte</small>
                      <strong>{formatIDR(txReport.summary.profit)}</strong>
                      <span>{txReport.summary.marginPercent}% dari omzet Lacte</span>
                    </article>
                  </div>

                  {txReport.truncated ? (
                    <div className="acc-warning-card">
                      Periode ini melebihi batas baris laporan. Angka di atas
                      berasal dari sebagian data - persempit rentang atau
                      tambah filter untuk angka yang pasti benar.
                    </div>
                  ) : null}

                  <div className="acc-table-card">
                    <div className="acc-table-scroll">
                      <table className="acc-table">
                        <thead>
                          <tr>
                            <th>Order</th>
                            <th>Waktu</th>
                            <th>Item</th>
                            <th>Katalog</th>
                            <th>Jual</th>
                            <th>Final</th>
                            <th>Supplier</th>
                            <th>Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {txReport.rows.map((row) => (
                            <tr key={row.id}>
                              <td data-label="Order">
                                <strong>{row.id}</strong>
                                <br />
                                <small>{row.status}</small>
                                {row.merchant_id &&
                                row.status === "success" &&
                                !row.receivable_paid_at ? (
                                  <small
                                    className="tx-unpaid-badge"
                                    title="Uang order ini masih di tangan toko - belum masuk omzet sampai transfer ke toko dicatat"
                                  >
                                    Belum dibayar merchant
                                  </small>
                                ) : null}
                              </td>
                              <td data-label="Waktu">
                                {formatTime(row.created_at)}
                                <br />
                                <small>{row.paymentName ?? "-"}</small>
                              </td>
                              <td data-label="Item">
                                <strong>{row.gameName ?? "-"}</strong>
                                <br />
                                <small>{row.productLabel ?? "-"}</small>
                              </td>
                              <td data-label="Katalog">
                                {formatIDR(row.reference_price)}
                              </td>
                              <td data-label="Jual">
                                {formatIDR(row.selling_price)}
                              </td>
                              <td data-label="Final">
                                {formatIDR(row.final_price)}
                                {numFee(row.service_fee_amount) > 0 ? (
                                  <>
                                    <br />
                                    <small>
                                      termasuk biaya layanan{" "}
                                      {formatIDR(numFee(row.service_fee_amount))}
                                    </small>
                                  </>
                                ) : null}
                              </td>
                              <td data-label="Supplier">
                                {formatIDR(row.supplier_cost)}
                              </td>
                              <td data-label="Margin">
                                {formatIDR(row.nambah_profit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {txReport.rows.length === 0 ? (
                      <div className="acc-empty">
                        Tidak ada transaksi yang cocok filter.
                      </div>
                    ) : null}

                    {txReport.totalFiltered > 0 ? (
                      <div className="acc-tx-pagination">
                        <span>
                          Menampilkan{" "}
                          {txReport.offset + 1}-
                          {Math.min(
                            txReport.offset + txReport.rows.length,
                            txReport.totalFiltered,
                          )}{" "}
                          dari {txReport.totalFiltered} transaksi
                        </span>
                        <div>
                          <button
                            type="button"
                            disabled={txReport.offset === 0}
                            onClick={() => {
                              const next = Math.max(
                                0,
                                txReport.offset - txReport.limit,
                              );
                              setTxOffset(next);
                              void loadTransactions({
                                offset: next,
                              }).catch((error) =>
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "Gagal memuat halaman.",
                                ),
                              );
                            }}
                          >
                            Sebelumnya
                          </button>
                          <button
                            type="button"
                            disabled={!txReport.hasMore}
                            onClick={() => {
                              const next = txReport.offset + txReport.limit;
                              setTxOffset(next);
                              void loadTransactions({
                                offset: next,
                              }).catch((error) =>
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "Gagal memuat halaman.",
                                ),
                              );
                            }}
                          >
                            Berikutnya
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="acc-empty">Memuat laporan transaksi...</div>
              )}
            </>
          )}

          {section === "promotions" && overview && promotionData && (
            <>
              <SectionHead
                eyebrow="Pertumbuhan"
                title="Promo"
                copy="Campaign promo dikelola tanpa SQL, dengan kuota reservation yang aman terhadap checkout paralel."
                action={
                  <div className="acc-action-panel">
                    <Link className="acc-inline-button" href="/admin/banners">
                      Kelola banner beranda →
                    </Link>
                  </div>
                }
              />

              <div className="acc-module-summary">
                <article>
                  <small>Promo aktif</small>
                  <strong>{promotionData.promotions.filter((item) => item.active).length}</strong>
                  <span>{promotionData.promotions.length} total kampanye</span>
                </article>
                <article>
                  <small>Terpakai</small>
                  <strong>{promotionData.promotions.reduce((sum, item) => sum + item.redeemed, 0)}</strong>
                  <span>{promotionData.promotions.reduce((sum, item) => sum + item.reserved, 0)} sedang dipesan</span>
                </article>
              </div>

              <CollapsiblePanel
                title="Buat campaign promo"
                description="Kode, jenis diskon, kuota, dan jadwal berlaku."
              >
                {/*
                  Sepuluh field, dikelompokkan jadi empat agar operator
                  bisa mengisi berurutan tanpa membaca semua kolom dulu.

                  Sebelumnya form ini hanya berupa input polos dengan
                  `placeholder` sebagai satu-satunya penanda. Akibatnya
                  tiga field praktis kehilangan nama: batas minimum,
                  batas maksimum, dan kuota total hanya menampilkan
                  "Rp" atau "opsional" di dalam kotak - dan yang
                  untuk flash sale sama sekali tidak punya teks, hanya
                  atribut `title` yang tidak muncul di layar sentuh.

                  Dua field jadwal paling rawan disalahpahami: browser
                  menampilkan `datetime-local` sebagai "dd/mm/yyyy, --:--"
                  tanpa keterangan zona waktu, jadi operator tidak tahu
                  itu waktu lokal atau UTC.
                */}
                <div className="acc-form-block">
                  <span className="acc-form-block-title">Identitas</span>
                  <div className="testlab-form-grid">
                    <label className="acc-field">
                      <span>Kode promo</span>
                      <input
                        placeholder="GAJIAN10"
                        value={promoDraft.code}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            code: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                      <small>
                        Diketik pembeli saat checkout. Huruf besar, angka,
                        - atau _.
                      </small>
                    </label>

                    <label className="acc-field">
                      <span>Nama campaign</span>
                      <input
                        placeholder="Contoh: Diskon gajian"
                        value={promoDraft.name}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                      <small>Label internal. Tidak tampil ke pembeli.</small>
                    </label>
                  </div>
                </div>

                <div className="acc-form-block">
                  <span className="acc-form-block-title">Potongan</span>
                  <div className="testlab-form-grid">
                    <label className="acc-field">
                      <span>Jenis diskon</span>
                      <select
                        value={promoDraft.type}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            type: event.target.value as "flat" | "percentage",
                          }))
                        }
                      >
                        <option value="flat">Potongan tetap (Rp)</option>
                        <option value="percentage">Potongan persen (%)</option>
                      </select>
                      <small>Menentukan cara isi kolom nilai di bawah.</small>
                    </label>

                    <label className="acc-field">
                      <span>
                        {promoDraft.type === "flat"
                          ? "Potongan (Rp)"
                          : "Potongan (%)"}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="100"
                        placeholder={promoDraft.type === "flat" ? "1000" : "5"}
                        value={promoDraft.value}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            value: event.target.value,
                          }))
                        }
                      />
                      <small>
                        {promoDraft.type === "flat"
                          ? "Potongan dikurangkan sekali, berapa pun total belanja."
                          : "Persen dari total belanja, sebelum batas maksimum di bawah."}
                      </small>
                    </label>

                    <label className="acc-field">
                      <span>Minimal belanja (Rp)</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1000"
                        placeholder="20000"
                        value={promoDraft.minimumOrder}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            minimumOrder: event.target.value,
                          }))
                        }
                      />
                      <small>
                        Belanja di bawah nilai ini tidak dapat potongan.
                        Isi 0 untuk tanpa minimum.
                      </small>
                    </label>

                    <label className="acc-field">
                      <span>Maksimum potongan (Rp)</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1000"
                        placeholder="Tanpa batas"
                        value={promoDraft.maxDiscount}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            maxDiscount: event.target.value,
                          }))
                        }
                      />
                      <small>
                        {promoDraft.type === "flat"
                          ? "Berfungsi sama dengan nilai di atas, jadi boleh dikosongkan."
                          : "Batas atas potongan. Kosongkan bila diskon persen tidak perlu dibatasi."}
                      </small>
                    </label>
                  </div>
                </div>

                <div className="acc-form-block">
                  <span className="acc-form-block-title">Kuota</span>
                  <div className="testlab-form-grid">
                    <label className="acc-field">
                      <span>Kuota total</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        placeholder="Tanpa batas"
                        value={promoDraft.quota}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            quota: event.target.value,
                          }))
                        }
                      />
                      <small>
                        Batas untuk semua pengguna. Kosongkan untuk tanpa
                        batas.
                      </small>
                    </label>

                    <label className="acc-field">
                      <span>Kuota per pengguna</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        placeholder="1"
                        value={promoDraft.quotaPerUser}
                        onChange={(event) =>
                          setPromoDraft((current) => ({
                            ...current,
                            quotaPerUser: event.target.value,
                          }))
                        }
                      />
                      <small>
                        Berapa kali satu akun boleh memakai promo ini.
                      </small>
                    </label>
                  </div>
                </div>

                <div className="acc-form-block">
                  <span className="acc-form-block-title">Jadwal</span>
                  <div className="testlab-form-grid">
                    {/*
                      Dua field jadwal ini dulu `datetime-local` polos.

                      Selain format yang mengikuti locale - "01/11/2026"
                      bisa berarti 1 November atau 11 Januari - keduanya juga
                      tidak menjelaskan zona waktunya. Salah baca tidak
                      ketahuan sampai campaign selesai.

                      Sekarang keduanya lewat `DateTimePicker`, yang memakai
                      kelas `.acc-cal-*` sama dengan kalender laporan. Jadi
                      tanggal di form promo dan di laporan keuangan bakal
                      terlihat identik, dan aturan tanggalnya hanya ditulis
                      sekali di `@/lib/admin-calendar`.

                      `minDate` di field "Berakhir" sengaja memakai tanggal
                      mulai TANPA jamnya: kalau tanggal yang sama masih
                      bisa dipilih, operator bisa membuat promo yang
                      berakhir sebelum mulai tanpa pernah melihat
                      peringatannya.
                    */}
                    <DateTimePicker
                      label="Mulai berlaku"
                      hint="Kosongkan untuk langsung aktif."
                      value={promoDraft.startsAt}
                      onChange={(next) =>
                        setPromoDraft((current) => ({ ...current, startsAt: next }))
                      }
                    />

                    <DateTimePicker
                      label="Berakhir"
                      hint="Isi untuk flash sale. Kosongkan untuk berjalan terus."
                      value={promoDraft.endsAt}
                      minDate={promoDraft.startsAt.slice(0, 10) || undefined}
                      onChange={(next) =>
                        setPromoDraft((current) => ({ ...current, endsAt: next }))
                      }
                    />
                  </div>
                </div>

                <div className="acc-action-panel">
                  <button
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      promoDraft.code.trim().length < 3 ||
                      promoDraft.name.trim().length === 0 ||
                      Number(promoDraft.value) <= 0
                    }
                    onClick={() => void createPromotion()}
                  >
                    {busy === "promotion-create" ? "Membuat..." : "Buat promo"}
                  </button>
                  <small className="acc-action-hint">
                    Promo baru aktif seketika, kecuali jadwal diisi.
                  </small>
                </div>
              </CollapsiblePanel>

              <div className="acc-table-card">
                {/*
                  `is-six` wajib di sini, bukan opsional.

                  Tabel ini punya enam kolom, tapi `.acc-receipts-row`
                  hanya menyediakan lima. Tanpa modifier itu, kolom
                  "Aksi" tidak punya tempat dan turun ke baris kedua -
                  tombol Hapus jadi tidak sejajar antarbaris, dan
                  baris jadi tinggi dua kali lipatnya hanya karena satu
                  kolom terakhir.

                  Label kolom memakai bahasa Indonesia, bukan istilah
                  dari nama kolom di database. "Benefit" tidak
                  dipakai siapa pun di sini, dan "Quota" sudah
                  ditulis "Kuota" di bagian lain halaman ini.
                */}
                <div className="acc-receipts-head is-six">
                  <span>Kampanye</span>
                  <span>Potongan</span>
                  <span>Kuota</span>
                  <span>Pemakaian</span>
                  <span>Status</span>
                  <span>Aksi</span>
                </div>
                {promotionData.promotions.map((promo) => (
                  <div className="acc-receipts-row is-six" key={promo.code}>
                    <div>
                      <strong>{promo.code}</strong>
                      <span>{promo.name}</span>
                      {(promo.startsAt || promo.endsAt) && (
                        <span className="acc-promo-schedule">
                          {promo.startsAt
                            ? new Date(promo.startsAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
                            : "langsung"}
                          {" → "}
                          {promo.endsAt
                            ? new Date(promo.endsAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
                            : "tanpa akhir"}
                        </span>
                      )}
                    </div>
                    <strong>
                      {promo.type === "flat"
                        ? formatIDR(promo.value)
                        : promo.value + "%"}
                    </strong>
                    <span>
                      {promo.quota === null
                        ? "Tanpa batas"
                        : `${promo.redeemed + promo.reserved}/${promo.quota}`}
                      {promo.quota !== null &&
                        promo.redeemed + promo.reserved >= promo.quota && (
                          <b className="acc-status failed acc-inline-chip">Habis</b>
                        )}
                    </span>
                    <span>
                      {promo.redeemed} terpakai
                      <br />
                      {promo.reserved} sedang dipesan
                    </span>
                    <button
                      type="button"
                      className={`promo-status-toggle ${promo.active ? "is-active" : "is-inactive"}`}
                      aria-pressed={promo.active}
                      aria-label={`${promo.code}: ${promo.active ? "nonaktifkan" : "aktifkan"} promo`}
                      disabled={Boolean(busy)}
                      onClick={() => void togglePromotion(promo.code, !promo.active)}
                    >
                      <span className="promo-status-dot" aria-hidden="true" />
                      {promo.active ? "Aktif" : "Nonaktif"}
                    </button>
                    <div className="acc-action-panel">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void deletePromotion(promo.code)}
                      >
                        {busy === "promotion-delete:" + promo.code
                          ? "Menghapus..."
                          : "Hapus"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {section === "affiliates" && overview && affiliateData && (
            <>
              <SectionHead
                eyebrow="Mitra"
                title="Afiliasi"
                copy="Satu tempat untuk mitra: periksa permintaan, buat dan hubungkan kode, bagikan link, lalu pantau kinerjanya. Pencairan ada di halaman terpisah."
                action={
                  <div className="acc-action-panel">
                    <Link className="acc-primary-link" href="/admin/affiliates">
                      Buka pencairan afiliasi →
                    </Link>
                  </div>
                }
              />

              {/*
                Urutannya mengikuti pertanyaan operator:
                  "ada yang minta gabung?" -> permissions
                  "mitra saya siapa, link-nya mana?" -> direktori
                  "bagaimana hasilnya?" -> kinerja + ledger
                Direktori tidak lagi hidup di halaman pencairan, jadi
                membuat mitra tidak lagi menuntut perpindahan halaman.
              */}
              <AffiliatePerformancePanel />
              <AffiliateDirectoryPanel />

              <div className="acc-metrics">
                <article>
                  <small>Mitra aktif</small>
                  <strong>{affiliateData.stats.active}</strong>
                  <span>dari {affiliateData.stats.affiliates} mitra</span>
                </article>
                <article>
                  <small>Menunggu</small>
                  <strong>{formatIDR(affiliateData.stats.pending)}</strong>
                  <span>order lunas atau diproses</span>
                </article>
                <article>
                  <small>Siap dicairkan</small>
                  <strong>{formatIDR(affiliateData.stats.available)}</strong>
                  <span>{formatIDR(affiliateData.stats.reserved)} sedang dipesan</span>
                </article>
                <article>
                  <small>Sudah dibayar</small>
                  <strong>{formatIDR(affiliateData.stats.withdrawn)}</strong>
                  <span>pencairan selesai</span>
                </article>
              </div>

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Order</span>
                  <span>Mitra</span>
                  <span>Laba dasar</span>
                  <span>Komisi</span>
                  <span>Status</span>
                </div>
                {affiliateData.commissions.slice(0, 50).map((row) => (
                  <div className="acc-receipts-row" key={row.id}>
                    <div>
                      <strong>{row.orderId}</strong>
                      <span>{formatTime(row.createdAt)}</span>
                    </div>
                    <span>{row.affiliateCode}</span>
                    <strong>{formatIDR(row.baseProfit)}</strong>
                    <strong>{formatIDR(row.amount)}</strong>
                    <span className={"acc-status " + row.status}>
                      {COMMISSION_STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </div>
                ))}
                {affiliateData.commissions.length === 0 && (
                  <div className="acc-empty">Belum ada riwayat komisi.</div>
                )}
              </div>
            </>
          )}

          {section === "users" && (
            <>
              <SectionHead
                eyebrow="Akun"
                title="Pengguna & akses"
                copy="Lookup customer memakai profile server-side dan agregasi transaksi tanpa mengekspos credential auth."
              />

              {/*
               * Kartu akun admin hanya untuk yang boleh mengelolanya.
               *
               * Menyembunyikan bagian ini di klien bukan pengaman - route-nya sudah
               * menolak 403. Tapi menampilkan tombol yang pasti ditolak
               * hanya membingungkan, dan membuat operator mengira fiturnya
               * rusak.
               */}
              {canManageAdmins(adminRole) && (
                <section className="acc-admin-access">
                  <header className="acc-admin-access-head">
                    <div>
                      <h3>Akun admin</h3>
                      <p>
                        {adminAccounts?.admins.filter((item) => item.active).length ?? 0} aktif
                        dari {adminAccounts?.admins.length ?? 0} akun terdaftar.
                        {" "}Menonaktifkan akses tidak langsung mengeluarkan orang dari
                        dashboard: sesi yang sedang berjalan tetap berlaku sampai
                        cookie habis, sekitar 2 jam.
                      </p>
                    </div>
                  </header>

                  <div className="acc-admin-access-list">
                    {(adminAccounts?.admins ?? []).map((item) => {
                      /*
                       * Syarat disable dihitung di klien dengan fungsi yang
                       * SAMA dengan yang dipakai server. Mengulang syaratnya
                       * di sini dengan tangan sudah pasti akan menyimpang
                       * begitu aturannya berubah.
                       */
                      const blocksLastSuperadmin = wouldRemoveLastSuperadmin({
                        targetRole: item.role,
                        targetActive: item.active,
                        nextActive: false,
                        nextRole: item.role,
                        activeSuperadminCount: item.activeSuperadmins,
                      });
                      const isBusy = busy === `admin-access:${item.userId}`;
                      const demoteBlocked = item.isSelf || blocksLastSuperadmin;

                      return (
                        <div
                          className={`acc-admin-access-row${item.active ? "" : " is-off"}`}
                          key={item.userId}
                        >
                          <div>
                            <strong>
                              {item.displayName ?? item.email ?? item.userId.slice(0, 8) + "…"}
                              {item.isSelf && <em className="acc-self-tag">akun Anda</em>}
                            </strong>
                            <span>
                              {item.email ?? item.whatsapp ?? item.userId}
                            </span>
                          </div>
                          <span className={`acc-role-chip ${item.role}`}>
                            {item.role === "superadmin" ? "Superadmin" : "Admin"}
                          </span>
                          <span className={`acc-status ${item.active ? "success" : "failed"}`}>
                            {item.active ? "Aktif" : "Nonaktif"}
                          </span>
                          {item.active ? (
                            <button
                              type="button"
                              className="acc-btn-danger"
                              disabled={demoteBlocked || isBusy}
                              title={
                                item.isSelf
                                  ? "Anda tidak bisa mencabut akses milik akun Anda sendiri."
                                  : blocksLastSuperadmin
                                    ? "Ini superadmin aktif terakhir. Menonaktifkannya akan menutup dashboard untuk semua orang."
                                    : "Cabut akses dashboard dari akun ini."
                              }
                              onClick={() =>
                                void changeAdminAccess({
                                  userId: item.userId,
                                  role: item.role,
                                  active: false,
                                })
                              }
                            >
                              {isBusy ? "Menyimpan..." : "Nonaktifkan"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="acc-btn"
                              disabled={isBusy}
                              onClick={() =>
                                void changeAdminAccess({
                                  userId: item.userId,
                                  role: item.role,
                                  active: true,
                                })
                              }
                            >
                              {isBusy ? "Menyimpan..." : "Aktifkan lagi"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {adminAccounts && adminAccounts.admins.length === 0 && (
                      <div className="acc-empty">Belum ada akun admin.</div>
                    )}
                  </div>
                </section>
              )}

              {/*
               * Pencarian + jumlah total.
               *
               * Jumlah total selalu ditulis walaupun tabel sedang memangkas. Tanpa
               * angka ini, operator tidak punya alasan untuk menduga
               * bahwa ada akun yang tidak terlihat - dan itulah bentuk
               * bug yang baru saja diperbaiki: user terdaftar tapi tidak
               * pernah muncul di mana pun.
               */}
              <div className="acc-users-toolbar">
                <label className="acc-field">
                  <span>Cari pengguna</span>
                  <input
                    type="search"
                    value={usersQuery}
                    aria-label="Cari pengguna berdasarkan nama, email, atau WhatsApp"
                    placeholder="nama, email, atau WhatsApp"
                    onChange={(event) => {
                      setUsersQuery(event.target.value);
                      // Halaman kembali ke awal: menjaga halaman 4 saat
                      // hasil menyempit membuat daftar tampak kosong.
                      setUsersPage(0);
                    }}
                  />
                </label>
                <p className="acc-table-note">
                  {normalizedUsersQuery
                    ? `${filteredUsers.length} dari ${usersData?.total ?? 0} akun cocok dengan "${usersQuery.trim()}".`
                    : `${usersData?.total ?? 0} akun terdaftar. Akun yang belum pernah-ordered atau menyimpan profil tetap ikut dihitung.`}
                </p>
              </div>

              <div className="acc-table-card">
                <div className="acc-users-head">
                  <span>Pengguna</span>
                  <span>WhatsApp</span>
                  <span>Pesanan</span>
                  <span>Total belanja</span>
                  {canManageAdmins(adminRole) && <span>Akses admin</span>}
                </div>
                {visibleUsers.map((item) => {
                  /*
                   * Status admin diambil dari daftar akun admin, bukan
                   * dijawab ulang di sini. Dua sumber berarti dua jawaban
                   * yang bisa berbeda - dan layar akan menampilkan "bukan
                   * admin" untuk orang yang sebenarnya punya akses.
                   */
                  const adminRow = adminAccounts?.admins.find(
                    (entry) => entry.userId === item.userId,
                  );
                  const canSeeControls = canManageAdmins(adminRole);
                  const chosenRole = promoteRole[item.userId] ?? "admin";
                  const isBusy = busy === `admin-access:${item.userId}`;

                  return (
                  <div className="acc-users-row" key={item.userId}>
                    <div>
                      <strong>
                        {item.displayName ?? item.email ?? item.userId.slice(0, 8) + "…"}
                      </strong>
                      <span>
                        {item.displayName && item.email ? item.email : item.userId}
                      </span>
                    </div>
                    <span>{item.whatsapp ?? "-"}</span>
                    <strong>{item.orders} · {item.success} success</strong>
                    <div>
                      <strong>{formatIDR(item.spend)}</strong>
                      <span>{formatTime(item.lastOrderAt)}</span>
                    </div>
                    {canSeeControls && (
                      <div className="acc-users-access">
                        {adminRow ? (
                          <>
                            <span
                              className={`acc-role-chip ${adminRow.role}${
                                adminRow.active ? "" : " is-off"
                              }`}
                            >
                              {adminRow.role === "superadmin" ? "Superadmin" : "Admin"}
                            </span>
                            {!adminRow.active && <small>nonaktif</small>}
                          </>
                        ) : (
                          <>
                            <select
                              aria-label={`Role untuk ${item.displayName ?? item.email ?? item.userId}`}
                              value={chosenRole}
                              disabled={isBusy}
                              onChange={(event) =>
                                setPromoteRole((current) => ({
                                  ...current,
                                  [item.userId]: event.target.value as
                                    | "admin"
                                    | "superadmin",
                                }))
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="superadmin">Superadmin</option>
                            </select>
                            <button
                              type="button"
                              className="acc-btn"
                              disabled={isBusy}
                              onClick={() =>
                                void changeAdminAccess({
                                  userId: item.userId,
                                  role: chosenRole,
                                  active: true,
                                })
                              }
                            >
                              {isBusy ? "..." : "Berikan"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
                {usersData && usersData.users.length === 0 && (
                  <div className="acc-empty">Belum ada akun terdaftar.</div>
                )}
                {usersData &&
                  usersData.users.length > 0 &&
                  filteredUsers.length === 0 && (
                    <div className="acc-empty">
                      Tidak ada akun yang cocok dengan &quot;{usersQuery.trim()}&quot;.
                    </div>
                  )}
              </div>

              {usersPageCount > 1 && (
                <div className="acc-tx-pagination">
                  <span>
                    Menampilkan{" "}
                    {safeUsersPage * USERS_PER_PAGE + 1}-
                    {Math.min(
                      (safeUsersPage + 1) * USERS_PER_PAGE,
                      filteredUsers.length,
                    )}{" "}
                    dari {filteredUsers.length} akun
                  </span>
                  <div>
                    <button
                      type="button"
                      disabled={safeUsersPage === 0}
                      onClick={() => setUsersPage(Math.max(0, safeUsersPage - 1))}
                    >
                      Sebelumnya
                    </button>
                    <span className="acc-tx-pageinfo">
                      {safeUsersPage + 1} / {usersPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={safeUsersPage >= usersPageCount - 1}
                      onClick={() =>
                        setUsersPage(
                          Math.min(usersPageCount - 1, safeUsersPage + 1),
                        )
                      }
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {section === "system" && overview && (
            <>
              <SectionHead
                eyebrow="Operasional"
                title="Kesiapan sistem & produksi"
                copy="Konfigurasi service sekarang dan backlog yang harus selesai sebelum live money."
              />

              <div className="acc-service-grid">
                {overview.system.services.map((service) => (
                  <article key={service.id}>
                    <span className={`acc-health ${service.state}`} />
                    <div>
                      <strong>{service.name}</strong>
                      <p>{service.detail}</p>
                    </div>
                    <b>{service.state}</b>
                  </article>
                ))}
              </div>

              <div className="acc-system-note">
                <div>
                  <small>Mode pembayaran supplier</small>
                  <strong>{overview.system.fulfillmentMode}</strong>
                </div>
                <div>
                  <small>Mode uji coba</small>
                  <strong>
                    {overview.system.flowTest ? "Aktif" : "Nonaktif"}
                  </strong>
                </div>
              </div>

              <PaymentGatewayPanel />

              <div className="acc-action-panel">
                <Link className="acc-inline-button" href="/admin/banners">
                  Kelola banner beranda →
                </Link>
                <Link className="acc-inline-button" href="/admin/operations">
                  Buka Operations Center →
                </Link>
                <Link className="acc-inline-button" href="/admin/test-lab">
                  Buka Test Lab →
                </Link>
                <button
                  type="button"
                  onClick={() => void runReconciliation()}
                  disabled={Boolean(busy)}
                >
                  {busy === "reconciliation"
                    ? "Merekonsiliasi..."
                    : "Jalankan rekonsiliasi"}
                </button>
                <button
                  type="button"
                  onClick={() => void testTelegram()}
                  disabled={Boolean(busy)}
                >
                  {busy === "telegram" ? "Mengirim..." : "Tes Telegram"}
                </button>
                <button
                  type="button"
                  onClick={() => void dispatchTelegramQueue()}
                  disabled={Boolean(busy)}
                  title={
                    actionStates.telegram_queue?.message ||
                    "Kirim notifikasi yang tertunda di antrean."
                  }
                >
                  {busy === "telegram_queue"
                    ? "Mengirim antrean..."
                    : "Kirim antrean Telegram"}
                </button>
                <span className="acc-status processing">
                  {numberOrDash(overview.stats.supplierPending)} order menunggu supplier
                </span>
                <span className="acc-status receipt-sending">
                  {numberOrDash(overview.stats.receiptSending)} email sedang dikirim
                </span>
              </div>

              {readiness && (
                <div className="acc-readiness-panel">
                  <div className="acc-readiness-head">
                    <div>
                      <small>
                        {readiness.version} · {readiness.stage.toUpperCase().replaceAll("-", " ")}
                      </small>
                      <strong>
                        {readiness.automatedProductionReady
                          ? "Semua pemeriksaan produksi otomatis lolos"
                          : readiness.blockers + " hal menghalangi produksi"}
                      </strong>
                    </div>
                    <span>
                      {readiness.warnings} peringatan · {readiness.checks.length} pemeriksaan
                    </span>
                  </div>
                  <div className="acc-readiness-list">
                    {readiness.checks.map((check) => (
                      <div key={check.id}>
                        <span className={"acc-health " + check.status} />
                        <div>
                          <strong>{check.label}</strong>
                          <small>
                            {check.scope} · {check.detail}
                          </small>
                        </div>
                        <b>{check.status}</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="acc-roadmap-grid">
                <RoadmapCard
                  title="Digiflazz webhook apply"
                  status="live"
                  copy="Update supplier transaction dan order dari callback supplier dengan terminal-status guard dan receipt trigger."
                />
                <RoadmapCard
                  title="Reconciliation cron"
                  status="live"
                  copy="Endpoint cron + manual admin memulihkan order tertunda, supplier pending test, dan receipt failed secara idempotent."
                />
                <RoadmapCard
                  title="Affiliate lifecycle & payout"
                  status="live"
                  copy="Commission mengikuti status order, withdrawal memakai atomic allocation, dan payout dikonfirmasi superadmin."
                />
                <RoadmapCard
                  title="Rate limit & abuse guard"
                  status="live"
                  copy="Durable database limiter melindungi login, signup, account checker, dan order creation."
                />
                <RoadmapCard
                  title="1.0.0 stable code baseline"
                  status="live"
                  copy="CI tests/build, environment guide, E2E test guide, release checklist, monitoring, recovery, dan launch safety gate tersedia untuk operasional production."
                />
                <RoadmapCard
                  title="Live safety gate"
                  status="live"
                  copy="Template customer_no per game/product, frozen max_price, SKU mapping, dan double opt-in sebelum saldo Digiflazz dapat terpakai."
                />
              </div>
            </>
          )}
        </div>
      </section>
    </section>
  );
}
