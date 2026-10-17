import {
  isSupabaseConfigured,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase/server";

/**
 * Mode gerbang verifikasi akun — flag perilaku di `app_settings`, bukan env.
 *
 * Kenapa bukan env: env butuh restart untuk berubah, sedangkan ini adalah
 * KILL-SWITCH. Kalau mode enforce salah menolak order, operator harus bisa
 * mematikannya dari panel admin dalam hitungan detik, tanpa deploy.
 *
 * Default `off` supaya deploy kode gate tidak pernah mengubah perilaku
 * checkout sampai operator sengaja mengaktifkannya:
 *
 *   off      — gate tidak jalan sama sekali (kolom audit `skipped`).
 *   log      — SHADOW MODE: verifikasi dijalankan dan hasilnya dicatat di
 *              kolom audit + log, tapi order TIDAK pernah ditolak. Dipakai
 *              untuk membuktikan false-negative rate sebelum enforce dan
 *              sebagai bukti compliance untuk resubmit DOKU.
 *   enforce  — tolak order dengan ID invalid (422) dan saat provider
 *              gangguan (503). Satu-satunya mode yang memblokir.
 *
 * Fail-open ke `off` saat app_settings tidak terbaca — meniru pola
 * `getActivePaymentProvider`: kegagalan membaca setting tidak boleh
 * mengubah perilaku checkout.
 */

export type AccountVerificationMode = "off" | "log" | "enforce";

const ACCOUNT_VERIFICATION_MODE_KEY = "account_verification_mode";
const DEFAULT_MODE: AccountVerificationMode = "off";

/*
 * Cache in-memory 30 detik supaya checkout tidak membaca app_settings setiap
 * order. Konsekuensinya: perubahan mode (termasuk kill-switch) efektif
 * paling lama 30 detik — jendela itu lebih pendek daripada redeploy.
 */
const MODE_CACHE_TTL_MS = 30_000;

type AppSettingRow = {
  key: string;
  value: unknown;
  updated_at: string;
};

let cachedMode: { value: AccountVerificationMode; expiresAt: number } | null =
  null;

export function isAccountVerificationMode(
  value: unknown,
): value is AccountVerificationMode {
  return value === "off" || value === "log" || value === "enforce";
}

export async function getAccountVerificationMode(): Promise<AccountVerificationMode> {
  if (cachedMode && cachedMode.expiresAt > Date.now()) {
    return cachedMode.value;
  }

  if (!isSupabaseConfigured()) return DEFAULT_MODE;

  try {
    const rows = await supabaseSelect<AppSettingRow>("app_settings", {
      select: "key,value,updated_at",
      filters: { key: `eq.${ACCOUNT_VERIFICATION_MODE_KEY}` },
      limit: 1,
    });
    const value = isAccountVerificationMode(rows[0]?.value)
      ? rows[0].value
      : DEFAULT_MODE;

    cachedMode = { value, expiresAt: Date.now() + MODE_CACHE_TTL_MS };
    return value;
  } catch {
    return DEFAULT_MODE;
  }
}

export async function setAccountVerificationMode(
  mode: AccountVerificationMode,
): Promise<AccountVerificationMode> {
  const now = new Date().toISOString();
  await supabaseUpsert<AppSettingRow>(
    "app_settings",
    {
      key: ACCOUNT_VERIFICATION_MODE_KEY,
      value: mode,
      updated_at: now,
    },
    { onConflict: "key" },
  );

  cachedMode = { value: mode, expiresAt: Date.now() + MODE_CACHE_TTL_MS };
  return mode;
}
