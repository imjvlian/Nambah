import { formatIDR } from "@/lib/pricing";
import { BRAND } from "@/lib/brand";

/**
 * Isi pesan alert saldo supplier - bagian MURNI, tanpa I/O.
 *
 * Dipisah dari `supplier-balance.ts` karena modul latter mengimpor
 * `server-only`, Supabase, dan klien supplier, sedangkan aturan
 * "kapan saldo dianggap kritis" justru perlu diuji tanpa jaringan.
 *
 * KENAPA NAMA SUPPLIER JADI PARAMETER
 *
 * Versi lama menulis "Digiflazz" langsung ke dalam judul pesan. Waktu
 * Melostore ikut dipantau, pesan itu akan membaca "Saldo Melostore
 * KRITIS" - kesalahan yang terlihat benar dan baru ketahauan saat admin
 * panik.top up ke supplier yang salah. Nama supplier karena itu jadi
 * data, bukan teks yang ditulis di dalam string.
 */

export type SupplierBalanceStatus = "healthy" | "low" | "critical";

/**
 * Status saldo dari angka yang tersedia.
 *
 * `critical` diperiksa lebih dulu: kalau tidak, saldo di bawah ambang
 * kritis sekaligus di bawah ambang rendah akan dilaporkan sebagai
 * `low`, dan ambang kritis tidak akan pernah terpakai.
 */
export function getStatus(
  availableBalance: number,
  lowThreshold: number,
  criticalThreshold: number,
): SupplierBalanceStatus {
  if (availableBalance <= criticalThreshold) return "critical";
  if (availableBalance <= lowThreshold) return "low";
  return "healthy";
}

function statusLabel(status: SupplierBalanceStatus) {
  return status.toUpperCase();
}

/** Alasan alert tidak dikirim. */
export type BalanceSkipReason =
  | "not-requested"
  | "unchanged"
  | "no-change-reference"
  | "sandbox";

/** Kenapa alert tidak dikirim, atau dikirim. */
export type BalanceNotifyDecision =
  | { send: false; reason: BalanceSkipReason }
  | { send: true };

/**
 * Apakah alert saldo perlu dikirim?
 *
 * Empat syarat, dan semuanya harus terpenuhi:
 *
 * 1. Dipinta (tombol manual atau cron dengan notify).
 * 2. Status berubah - saldo yang naik-turun di sekitar ambang akan
 *    memicu pesan berulang tanpa batas.
 * 3. Pernah ada pembanding, KECUALI statusnya sudah `low`/`critical`.
 *    Snapshot pertama untuk supplier yang langsung kritis HARUS
 *    mengirim alert: justru saat itu saldo paling berbahaya dan belum
 *    ada yang mengetahuinya.
 * 4. Bukan sandbox. Di sandbox saldo selalu 0, jadi tanpa syarat ini
 *    cron mengirim "KRITIS" di setiap berjalan - dan alert yang selalu
 *    benar membuat operator mengabaikan semua alert.
 */
export function decideBalanceNotify(input: {
  notify: boolean;
  sandbox: boolean;
  statusChanged: boolean;
  previousStatus: SupplierBalanceStatus | "unknown" | null;
  status: SupplierBalanceStatus;
}): BalanceNotifyDecision {
  if (!input.notify) return { send: false, reason: "not-requested" };
  if (input.sandbox) return { send: false, reason: "sandbox" };
  if (!input.statusChanged) return { send: false, reason: "unchanged" };
  if (input.previousStatus === null && input.status === "healthy") {
    return { send: false, reason: "no-change-reference" };
  }
  return { send: true };
}

/**
 * Pesan alert saldo.
 *
 * `supplierLabel` wajib diisi. Pesan tanpa nama supplier tidak berguna:
 * admin tidak tahu harus top up ke mana.
 */
export function buildBalanceAlertMessage(input: {
  supplierLabel: string;
  status: SupplierBalanceStatus;
  previousStatus: SupplierBalanceStatus | "unknown" | null;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
  targetBalance: number;
  recommendedDeposit: number;
}) {
  const icon =
    input.status === "critical" ? "🚨" : input.status === "low" ? "⚠️" : "✅";
  const title =
    input.status === "healthy"
      ? `Saldo ${input.supplierLabel} kembali aman`
      : input.status === "critical"
        ? `Saldo ${input.supplierLabel} KRITIS`
        : `Saldo ${input.supplierLabel} rendah`;

  return [
    `${icon} ${BRAND.name} — ${title}`,
    "",
    `Supplier: ${input.supplierLabel}`,
    `Status: ${statusLabel(input.status)}`,
    input.previousStatus
      ? `Sebelumnya: ${input.previousStatus.toUpperCase()}`
      : null,
    `Saldo: ${formatIDR(input.balance)}`,
    `Reserved: ${formatIDR(input.reservedBalance)}`,
    `Tersedia: ${formatIDR(input.availableBalance)}`,
    "",
    `Target: ${formatIDR(input.targetBalance)}`,
    `Saran deposit: ${formatIDR(input.recommendedDeposit)}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}