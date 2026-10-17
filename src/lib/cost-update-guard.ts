/**
 * Pagar anomali untuk auto-sync harga supplier.
 *
 * Delta wajar antar-sync (market H2H bergerak) diterapkan otomatis.
 * Delta besar justru mencurigakan: harga supplier "melonjak" 40% dalam
 * satu jam biasanya berarti data sisi supplier sedang kacau - menerapkan
 * itu diam-diam ke seluruh katalog lebih berbahaya daripada menahannya
 * untuk review manual (dengan notifikasi Telegram).
 */
export type CostUpdateDecision = "apply" | "hold" | "unchanged";

/** Delta >10% ditahan; <=10% diterapkan otomatis. */
export const COST_DELTA_HOLD_RATIO = 0.1;

export function classifyCostUpdate(
  current: number,
  next: number,
): CostUpdateDecision {
  if (!Number.isFinite(current) || !Number.isFinite(next) || next < 0) {
    return "hold";
  }
  if (current === next) return "unchanged";
  if (current <= 0) {
    /*
     * Mapping dengan cost 0 adalah data rusak, bukan harga lama yang
     * valid - memperbaikinya bukan "lonjakan".
     */
    return "apply";
  }
  const delta = Math.abs(next - current) / current;
  return delta > COST_DELTA_HOLD_RATIO ? "hold" : "apply";
}
