"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatIDR, suggestPriceFromCost } from "@/lib/pricing";
import { compareCatalogItems, extractNominalAmount } from "@/lib/nominal-sort";
import AdminCatalogTools from "@/components/AdminCatalogTools";
import PaymentGatewayPanel from "@/components/PaymentGatewayPanel";
import { useConfirm } from "@/components/AdminConfirmDialog";
import AffiliatePerformancePanel from "@/components/AffiliatePerformancePanel";
import ReceiptPreview from "@/components/ReceiptPreview";
import { STATUS_LABEL as ORDER_STATUS_LABELS } from "@/lib/order-status-display";
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
  supplier: {
    mapped: boolean;
    sku: string | null;
    cost: number | null;
    active: boolean;
    lastSyncedAt: string | null;
    ready: boolean;
  };
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
  supplierSku: string;
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
    gmvToday: number;
    supplierBalance: number;
    reservedBalance: number;
    availableBalance: number;
    balanceCheckedAt: string | null;
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
  };
  byMethod: Array<{
    paymentMethodId: string;
    orders: number;
    revenue: number;
    supplierCost: number;
    profit: number;
  }>;
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
    supplierCost: number;
    profit: number;
    marginPercent: number;
    excludedCount: number;
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
import CollapsiblePanel from "@/components/admin/CollapsiblePanel";

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
    draft.supplierSku.trim() !== (product.supplier.sku ?? "")
  );
}

function marginOf(product: CatalogProduct, sellingPrice: number) {
  const cost = product.supplier.cost;
  if (cost === null || !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return null;
  }
  const margin = sellingPrice - cost;
  const percent = cost > 0 ? (margin / cost) * 100 : 0;
  return { margin, percent };
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
            ? "Live"
            : status === "foundation"
              ? "Foundation"
              : "Planned"}
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
  const { section: activeSection, setSection } = useAdminSection();
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

    const requested = new URLSearchParams(window.location.search).get(
      "seksi",
    );
    const match = requested
      ? NAV.find((item) => item.id === requested)
      : undefined;

    // Tanpa query yang cocok, tetap diisi dengan Ringkasan supaya tidak
    // ada render pertama tanpa section.
    setSection(match?.id ?? "overview");
  }, [activeSection, setSection]);

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
  const [adminRole, setAdminRole] = useState("");
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [pointsData, setPointsData] = useState<AdminPointsPayload | null>(null);
  const [affiliateData, setAffiliateData] = useState<AffiliatePayload | null>(null);
  const [promotionData, setPromotionData] = useState<PromotionPayload | null>(null);
  const [orderDetail, setOrderDetail] = useState<AdminOrderDetail | null>(null);
  const [usersData, setUsersData] = useState<AdminUsersPayload | null>(null);
  const [financeData, setFinanceData] = useState<FinancePayload | null>(null);
  const [cashFlowData, setCashFlowData] = useState<CashFlowPayload | null>(null);
  /*
   * Periode laporan arus kas.
   *
   * Default "30" bukan "7": sebagian besar toko ritel baru jalan kurang
   * dari sebulan, jadi laporan 7 hari hampir selalu kosong dan terlihat
   * seperti fiturnya rusak. Tiga puluh hari juga cukup untuk melihat pola
   * mingguan.
   */
  const [cashFlowPreset, setCashFlowPreset] = useState("30");

  /*
   * Filter laporan transaksi.
   *
   * Semua filter disimpan sebagai state terpisah, bukan satu objek
   * JSON, supaya reset per-field (mis. hanya mengosongkan pencarian)
   * tidak memicu fetch ulang yang tidak perlu.
   */
  const [txPreset, setTxPreset] = useState("30");
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

  async function loadFinance() {
    const response = await fetch("/api/admin/finance", { cache: "no-store" });
    const data = (await response.json()) as FinancePayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Financial reconciliation gagal dimuat.");
    }
    setFinanceData(data);
  }

  async function loadCashFlow(preset = cashFlowPreset) {
    const response = await fetch(
      `/api/admin/cash-flow?preset=${encodeURIComponent(preset)}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as CashFlowPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Laporan arus kas gagal dimuat.");
    }
    setCashFlowData(data);
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
      const response = await fetch(
        `/api/admin/cash-flow?preset=${encodeURIComponent(cashFlowPreset)}&format=csv`,
        { cache: "no-store" },
      );
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
  function buildTransactionQuery(extra?: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("preset", txPreset);
    if (txAppliedQuery.trim()) params.set("q", txAppliedQuery.trim());
    if (txStatus) params.set("status", txStatus);
    if (txPayment) params.set("payment", txPayment);
    for (const [key, value] of Object.entries(extra ?? {})) {
      params.set(key, value);
    }
    return params.toString();
  }

  async function loadTransactions(override?: { offset?: number }) {
    const query = buildTransactionQuery({
      offset: String(override?.offset ?? txOffset),
    });
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
      link.download = `transaksi_${txPreset}.csv`;
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
      if (section === "catalog" || section === "supplier") await loadCatalog();
      if (section === "receipts") await loadReceipts();
      if (section === "points") await loadPoints();
      if (section === "affiliates") await loadAffiliates();
      if (section === "promotions") await loadPromotions();
      if (section === "users") await loadUsers();
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
        setAdminRole(data.role ?? "admin");

        await Promise.all([loadOverview(), loadCatalog()]);
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
    if (section === "users" && !usersData) {
      void loadUsers().catch((error) =>
        setNotice(
          error instanceof Error ? error.message : "Data user gagal dimuat.",
        ),
      );
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
  }, [section, authState, orders.length, receipts.length, pointsData, affiliateData, promotionData, usersData, financeData, merchantData, readiness]);

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

  function resetDraft(product: CatalogProduct) {
    setDrafts((current) => ({
      ...current,
      [product.id]: draftFromProduct(product),
    }));
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
            <span className="brand-mark"><img src="/logo/nambah-logo.svg" alt="" /></span>
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
            <span className="brand-mark"><img src="/logo/nambah-logo.svg" alt="" /></span>
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
              {busy === "refresh" ? "Refreshing..." : "Refresh"}
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
                  <span className="acc-eyebrow">Operations overview</span>
                  <h1>Semua yang penting, satu layar.</h1>
                  <p>
                    Pantau order, supplier, receipt, pricing, dan kesiapan
                    sistem tanpa membuka database satu per satu.
                  </p>
                </div>
                <div className="acc-balance">
                  <small>Saldo Digiflazz tersedia</small>
                  <strong>{formatIDR(overview.finance.availableBalance)}</strong>
                  <span>
                    Update {formatTime(overview.finance.balanceCheckedAt)}
                  </span>
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
                  <small>GMV hari ini</small>
                  <strong>{formatIDR(overview.finance.gmvToday)}</strong>
                  <span>dari order berstatus berhasil</span>
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
                      <small>Points / Promo</small>
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
                  <span>Status</span>
                  <span />
                </div>
                <div className="admin-product-list">
                  {filteredProducts.map((product) => {
                    const draft =
                      drafts[product.id] ?? draftFromProduct(product);
                    const saving = busy === `save:${product.id}`;
                    const dirty = isDraftDirty(product, draft);
                    const sellingValue = Number(draft.sellingPrice);
                    const referenceValue = Number(draft.referencePrice);
                    const margin = marginOf(product, sellingValue);
                    const priceError =
                      Number.isFinite(sellingValue) &&
                      Number.isFinite(referenceValue) &&
                      referenceValue < sellingValue;

                    return (
                      <article
                        className={
                          "admin-product-row" + (dirty ? " admin-row-dirty" : "")
                        }
                        key={product.id}
                      >
                        <div className="admin-product-main">
                          <small>
                            {product.gameShortName} · {product.id}
                          </small>
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
                          <div className="admin-quick-price">
                            {[2, 5, 10].map((percent) => (
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
                        </div>

                        <div className="admin-supplier-fields">
                          <label>
                            <span>SKU supplier</span>
                            <input
                              value={draft.supplierSku}
                              placeholder="Belum mapped"
                              onChange={(event) =>
                                updateDraft(product.id, {
                                  supplierSku: event.target.value,
                                })
                              }
                            />
                          </label>
                          <div className="admin-cost-line">
                            <span>Modal</span>
                            <strong>
                              {product.supplier.cost === null
                                ? "-"
                                : formatIDR(product.supplier.cost)}
                            </strong>
                          </div>
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

                        <div className="admin-status-stack">
                          <span
                            className={`admin-status ${
                              product.supplier.ready
                                ? "ready"
                                : product.supplier.mapped
                                  ? "warning"
                                  : "muted"
                            }`}
                          >
                            {product.supplier.ready
                              ? "Supplier ready"
                              : product.supplier.mapped
                                ? "Mapped / unavailable"
                                : "Unmapped"}
                          </span>
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
                            Aktif
                          </label>
                          {dirty && (
                            <button
                              className="admin-reset-button"
                              type="button"
                              onClick={() => resetDraft(product)}
                            >
                              Reset
                            </button>
                          )}
                        </div>

                        <button
                          className="admin-save-button"
                          type="button"
                          disabled={Boolean(busy) || !dirty}
                          onClick={() => void saveProduct(product)}
                        >
                          {saving ? "Saving..." : "Simpan"}
                        </button>
                      </article>
                    );
                  })}
                </div>
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
                  <Link className="acc-primary-link" href="/admin/digiflazz">
                    Buka supplier catalog →
                  </Link>
                }
              />

              <div className="acc-metrics acc-metrics-three">
                <article>
                  <small>Saldo tersedia</small>
                  <strong>{formatIDR(catalog.balance.availableBalance)}</strong>
                  <span>{formatTime(catalog.balance.checkedAt)}</span>
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
                copy="Outstanding liability, reservation, FIFO lots, expiry, dan immutable ledger points."
                action={
                  <button
                    className="acc-primary-link"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void runPointsExpiry()}
                  >
                    {busy === "points-expiry" ? "Expiring..." : "Run expiry"}
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
                  <small>Available</small>
                  <strong>{pointsData.stats.available.toLocaleString("id-ID")} pts</strong>
                  <span>{pointsData.stats.accounts} akun loyalty</span>
                </article>
                <article>
                  <small>Reserved</small>
                  <strong>{pointsData.stats.reserved.toLocaleString("id-ID")} pts</strong>
                  <span>Checkout belum final</span>
                </article>
                <article>
                  <small>Lifetime redeemed</small>
                  <strong>{pointsData.stats.lifetimeRedeemed.toLocaleString("id-ID")} pts</strong>
                  <span>Dari {pointsData.stats.lifetimeEarned.toLocaleString("id-ID")} earned</span>
                </article>
              </div>

              <div className="acc-points-rules">
                <span>1 pt / {formatIDR(pointsData.rules.earnEveryIdr)}</span>
                <span>1 pt = {formatIDR(pointsData.rules.pointValueIdr)}</span>
                <span>Min. {pointsData.rules.minimumRedeem} pts</span>
                <span>Step {pointsData.rules.redeemStep} pts</span>
                <span>Max {Math.round(pointsData.rules.maxRedeemRate * 100)}% subtotal</span>
              </div>

              <div className="acc-grid-two acc-points-grid">
                <div className="acc-table-card">
                  <div className="acc-points-head">
                    <span>User</span>
                    <span>Available</span>
                    <span>Reserved</span>
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
                        className="acc-ghost-link"
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
                        className="acc-ghost-link"
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
                  <small>Checked</small>
                  <strong>{financeData?.stats.checked ?? 0}</strong>
                  <span>Snapshot terbaru</span>
                </article>
                <article>
                  <small>OK</small>
                  <strong>{financeData?.stats.ok ?? 0}</strong>
                  <span>Financial invariant cocok</span>
                </article>
                <article>
                  <small>Warning</small>
                  <strong>{financeData?.stats.warning ?? 0}</strong>
                  <span>Perlu ditinjau</span>
                </article>
                <article>
                  <small>Error</small>
                  <strong>{financeData?.stats.error ?? 0}</strong>
                  <span>Mismatch penting</span>
                </article>
              </div>

              <div className="acc-table-card">
                <div className="acc-finance-head">
                  <span>Order</span>
                  <span>Checked</span>
                  <span>Issues</span>
                  <span>Result</span>
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
                copy="Uang masuk dari penjualan, biaya supplier, margin, dan arus kas dari toko ritel. Biaya layanan merchant tidak dihitung sebagai pendapatan Lacte karena uangnya langsung ke merchant."
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
               * Kontrol periode.
               *
               * Tombol radio, bukan `<select>`: hanya empat pilihan, dan
               * radio membuat periode aktif terlihat tanpa harus membuka
               * daftar. Di layar sempit tombolnya membungkus sendiri.
               */}
              <div className="acc-cashflow-controls">
                <div
                  className="acc-segmented"
                  role="group"
                  aria-label="Periode laporan"
                >
                  {[
                    { value: "7", label: "7 hari" },
                    { value: "30", label: "30 hari" },
                    { value: "90", label: "90 hari" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={cashFlowPreset === option.value}
                      className={
                        cashFlowPreset === option.value ? "active" : ""
                      }
                      onClick={() => {
                        setCashFlowPreset(option.value);
                        void loadCashFlow(option.value).catch((error) =>
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Laporan arus kas gagal dimuat.",
                          ),
                        );
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {cashFlowData ? (
                  <small className="acc-cashflow-range">
                    {formatTime(cashFlowData.from)} &mdash;{" "}
                    {formatTime(cashFlowData.to)}
                  </small>
                ) : null}
              </div>

              <div className="acc-metrics">
                <article>
                  <small>Omzet</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.grossRevenue ?? 0)}
                  </strong>
                  <span>
                    {cashFlowData?.totals.orders ?? 0} pesanan selesai
                  </span>
                </article>
                <article>
                  <small>Biaya supplier</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.supplierCost ?? 0)}
                  </strong>
                  <span>Modal fulfill</span>
                </article>
                <article>
                  <small>Margin Lacte</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.grossProfit ?? 0)}
                  </strong>
                  <span>{cashFlowData?.totals.marginPercent ?? 0}% dari omzet</span>
                </article>
                <article>
                  <small>Masuk dari toko ritel</small>
                  <strong>
                    {formatIDR(cashFlowData?.totals.merchantSettled ?? 0)}
                  </strong>
                  <span>Transfer yang sudah dicatat</span>
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

                    <div className="acc-table-card">
                      <div className="acc-card-head">Rincian biaya</div>
                      <div className="acc-cost-list">
                        <div>
                          <span>Diskon (promo, poin, referral)</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.discounts)}
                          </strong>
                        </div>
                        <div>
                          <span>Komisi affiliate</span>
                          <strong>
                            {formatIDR(
                              cashFlowData.totals.affiliateCommission,
                            )}
                          </strong>
                        </div>
                        {/*
                         * Biaya layanan merchant ditampilkan dengan
                         * catatan tegas. Angka ini terlihat seperti
                         * pendapatan di laporan lain, dan itu sebab
                         * disengaja agar tidak disalahartikan.
                         */}
                        <div>
                          <span>
                            Biaya layanan merchant{" "}
                            <small>(bukan pendapatan Lacte)</small>
                          </span>
                          <strong>
                            {formatIDR(
                              cashFlowData.totals.merchantServiceFee,
                            )}
                          </strong>
                        </div>
                        {cashFlowData.totals.failedOrders > 0 ? (
                          <div>
                            <span>Pesanan gagal</span>
                            <strong>
                              {cashFlowData.totals.failedOrders}
                            </strong>
                          </div>
                        ) : null}
                      </div>

                      <div className="acc-receivable-box">
                        <div className="acc-receivable-head">
                          <strong>Posisi piutang toko ritel</strong>
                        </div>
                        <div>
                          <span>Piutang dari {cashFlowData.totals.merchantOrders} pesanan</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.merchantReceivable)}
                          </strong>
                        </div>
                        <div>
                          <span>Sudah ditransfer merchant</span>
                          <strong>
                            {formatIDR(cashFlowData.totals.merchantSettled)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            {cashFlowData.totals.merchantOutstanding < 0
                              ? "Sisa bayar (kredit merchant)"
                              : "Masih terutang"}
                          </span>
                          <strong>
                            {formatIDR(
                              Math.abs(cashFlowData.totals.merchantOutstanding),
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
                  <div
                    className="acc-segmented"
                    role="group"
                    aria-label="Periode laporan"
                  >
                    {[
                      { value: "7", label: "7 hari" },
                      { value: "30", label: "30 hari" },
                      { value: "90", label: "90 hari" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={txPreset === option.value}
                        className={txPreset === option.value ? "active" : ""}
                        onClick={() => {
                          setTxPreset(option.value);
                          setTxOffset(0);
                          void loadTransactions({ offset: 0 }).catch(
                            (error) =>
                              setNotice(
                                error instanceof Error
                                  ? error.message
                                  : "Laporan transaksi gagal dimuat.",
                              ),
                          );
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

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
                        {txReport.summary.excludedCount > 0
                          ? `${txReport.summary.excludedCount} tidak dihitung`
                          : "Semua selesai"}
                      </span>
                    </article>
                    <article>
                      <small>Omzet</small>
                      <strong>
                        {formatIDR(txReport.summary.grossRevenue)}
                      </strong>
                      <span>Harga final yang dibayar</span>
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
                      <span>{txReport.summary.marginPercent}% dari omzet</span>
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
                                {row.merchant_id ? (
                                  <>
                                    <br />
                                    <small>termasuk biaya layanan</small>
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
                  <span>{promotionData.promotions.length} total campaign</span>
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
                <input
                  placeholder="KODE"
                  value={promoDraft.code}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <input
                  placeholder="Nama campaign"
                  value={promoDraft.name}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
                <select
                  value={promoDraft.type}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      type: event.target.value as "flat" | "percentage",
                    }))
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="percentage">Percentage</option>
                </select>
                <input
                  type="number"
                  placeholder="Value"
                  value={promoDraft.value}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  placeholder="Min. belanja (Rp)"
                  title="Minimal pembelian agar promo berlaku"
                  value={promoDraft.minimumOrder}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      minimumOrder: event.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  placeholder="Maks diskon (Rp, opsional)"
                  title="Batas maksimal potongan untuk promo persen"
                  value={promoDraft.maxDiscount}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      maxDiscount: event.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  placeholder="Kuota total (opsional)"
                  title="Maksimal pemakaian promo oleh semua pengguna; kosongkan untuk tanpa batas"
                  value={promoDraft.quota}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      quota: event.target.value,
                    }))
                  }
                />
                <input
                  type="number"
                  placeholder="Kuota per user (default 1)"
                  title="Berapa kali satu akun boleh memakai promo ini"
                  value={promoDraft.quotaPerUser}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      quotaPerUser: event.target.value,
                    }))
                  }
                />
                <input
                  type="datetime-local"
                  title="Mulai berlaku (opsional — kosongkan untuk langsung aktif)"
                  value={promoDraft.startsAt}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      startsAt: event.target.value,
                    }))
                  }
                />
                <input
                  type="datetime-local"
                  title="Berakhir (opsional — isi untuk flash sale)"
                  value={promoDraft.endsAt}
                  onChange={(event) =>
                    setPromoDraft((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void createPromotion()}
                >
                  {busy === "promotion-create" ? "Membuat..." : "Buat promo"}
                </button>
              </CollapsiblePanel>

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Campaign</span>
                  <span>Benefit</span>
                  <span>Quota</span>
                  <span>Usage</span>
                  <span>Status</span>
                  <span>Aksi</span>
                </div>
                {promotionData.promotions.map((promo) => (
                  <div className="acc-receipts-row" key={promo.code}>
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
                        ? "∞"
                        : `${promo.redeemed + promo.reserved}/${promo.quota}`}
                      {promo.quota !== null &&
                        promo.redeemed + promo.reserved >= promo.quota && (
                          <b className="acc-status failed" style={{ marginLeft: 6 }}>habis</b>
                        )}
                    </span>
                    <span>{promo.redeemed} used · {promo.reserved} reserved</span>
                    <button
                      type="button"
                      className={`promo-status-toggle ${promo.active ? "is-active" : "is-inactive"}`}
                      aria-pressed={promo.active}
                      aria-label={`${promo.code}: ${promo.active ? "nonaktifkan" : "aktifkan"} promo`}
                      disabled={Boolean(busy)}
                      onClick={() => void togglePromotion(promo.code, !promo.active)}
                    >
                      <span className="promo-status-dot" aria-hidden="true" />
                      {promo.active ? "Active" : "Inactive"}
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
                copy="Commission lifecycle mengikuti status order, withdrawal memakai allocation ledger, dan payout tetap dikonfirmasi operator."
                action={
                  <div className="acc-action-panel">
                    <Link className="acc-inline-button" href="/admin/affiliates">
                      + Buat affiliate
                    </Link>
                    <Link className="acc-primary-link" href="/admin/affiliates">
                      Open withdrawal center →
                    </Link>
                  </div>
                }
              />
              <AffiliatePerformancePanel />
              <div className="acc-metrics">
                <article>
                  <small>Active affiliates</small>
                  <strong>{affiliateData.stats.active}</strong>
                  <span>Dari {affiliateData.stats.affiliates} partner</span>
                </article>
                <article>
                  <small>Pending</small>
                  <strong>{formatIDR(affiliateData.stats.pending)}</strong>
                  <span>Order paid / processing</span>
                </article>
                <article>
                  <small>Available</small>
                  <strong>{formatIDR(affiliateData.stats.available)}</strong>
                  <span>{formatIDR(affiliateData.stats.reserved)} reserved</span>
                </article>
                <article>
                  <small>Withdrawn</small>
                  <strong>{formatIDR(affiliateData.stats.withdrawn)}</strong>
                  <span>Sudah dibayarkan</span>
                </article>
              </div>

              <div className="acc-table-card">
                <div className="acc-receipts-head">
                  <span>Order</span>
                  <span>Affiliate</span>
                  <span>Base profit</span>
                  <span>Commission</span>
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
                    <span className={"acc-status " + row.status}>{row.status}</span>
                  </div>
                ))}
                {affiliateData.commissions.length === 0 && (
                  <div className="acc-empty">Belum ada commission ledger.</div>
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
              <div className="acc-table-card">
                <div className="acc-users-head">
                  <span>Pengguna</span>
                  <span>WhatsApp</span>
                  <span>Pesanan</span>
                  <span>Total belanja</span>
                </div>
                {(usersData?.users ?? []).slice(0, 100).map((item) => (
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
                  </div>
                ))}
                {usersData && usersData.users.length === 0 && (
                  <div className="acc-empty">Belum ada customer account activity.</div>
                )}
              </div>
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
