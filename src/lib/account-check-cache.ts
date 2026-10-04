import {
  isSupabaseConfigured,
  supabaseDelete,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase/server";

/**
 * Durable cache hasil pengecekan akun.
 *
 * `accountCache` di dalam route `game-account/check` hanya hidup di memory satu
 * instance serverless, jadi hilang tiap cold start/redeploy dan tidak dipakai
 * lintas instance. Table ini menggantikan kelemahannya: satu User ID + game
 * cukup di-cek provider sekali, lalu dipakai ulang sampai `expires_at`.
 *
 * Aturan yang dijaga di file ini:
 * - Semua operasi dibungkus try/catch dan selalu `return null` saat gagal.
 *   Cache hanya boleh mempercepat, tidak boleh membuat pengecekan error.
 * - Hanya hasil BERHASIL yang ditulis. "Akun tidak ditemukan" tidak pernah
 *   di-cache supaya user yang akunnya baru dibuat tidak terkunci negative cache.
 */

const TABLE = "account_check_cache";
const CONFLICT_KEY = "game_id,user_id,server_id";

/**
 * Nickname dan region sebuah akun nyaris tidak berubah dalam 24 jam. TTL
 * pendek tetap lebih aman daripada cache abadi, dan baris kedaluwarsa tetap
 * bisa dibaca lewat purge berkala.
 */
export const ACCOUNT_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type AccountCheckProvider = "volsever" | "mimih";

export type CachedAccountCheck = {
  nickname: string;
  server: string | null;
  region: string | null;
  provider: AccountCheckProvider;
};

type AccountCheckCacheRow = {
  nickname: string | null;
  resolved_server: string | null;
  region: string | null;
  provider: AccountCheckProvider;
  expires_at: string;
};

function normalizeServerId(serverId?: string | null) {
  return (serverId ?? "").trim();
}

/** Baca cache durable. `null` = cache miss, atau cache bermasalah. */
export async function readCachedAccountCheck(
  gameId: string,
  userId: string,
  serverId?: string | null,
): Promise<CachedAccountCheck | null> {
  if (!isSupabaseConfigured()) return null;

  const normalizedServer = normalizeServerId(serverId);

  try {
    const rows = await supabaseSelect<AccountCheckCacheRow>(TABLE, {
      select: "nickname,resolved_server,region,provider,expires_at",
      filters: {
        game_id: `eq.${gameId}`,
        user_id: `eq.${userId}`,
        server_id: `eq.${normalizedServer}`,
      },
      limit: 1,
    });

    const row = rows[0];
    const nickname = row?.nickname?.trim();
    if (!row || !nickname) return null;

    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      // Dianggap miss. Baris akan ditimpa saat pengecekan provider berikutnya
      // berhasil, jadi tidak perlu hapus di sini.
      return null;
    }

    return {
      nickname,
      server: row.resolved_server || null,
      region: row.region?.trim() || null,
      provider: row.provider,
    };
  } catch (error) {
    // Cache read tidak boleh menghentikan pengecekan.
    console.error("Account check cache read failed", error);
    return null;
  }
}

/** Simpan hasil pengecekan yang berhasil. */
export async function writeCachedAccountCheck(input: {
  gameId: string;
  userId: string;
  serverId?: string | null;
  nickname: string;
  resolvedServer?: string | null;
  region?: string | null;
  provider: AccountCheckProvider;
}) {
  if (!isSupabaseConfigured()) return;

  const nickname = input.nickname.trim();
  if (!nickname) return;

  const now = Date.now();

  try {
    await supabaseUpsert<AccountCheckCacheRow>(
      TABLE,
      {
        game_id: input.gameId,
        user_id: input.userId,
        server_id: normalizeServerId(input.serverId),
        nickname,
        resolved_server: input.resolvedServer?.trim() || null,
        region: input.region?.trim() || null,
        provider: input.provider,
        checked_at: new Date(now).toISOString(),
        expires_at: new Date(now + ACCOUNT_CHECK_CACHE_TTL_MS).toISOString(),
      },
      { onConflict: CONFLICT_KEY },
    );
  } catch (error) {
    // Cache write gagal tidak boleh menggagalkan response untuk user.
    console.error("Account check cache write failed", error);
  }
}

/**
 * Hapus baris yang sudah kedaluwarsa. Dipanggil dari cron reconcile.
 * Mengembalikan jumlah baris yang terhapus, atau 0 bila gagal.
 */
export async function purgeExpiredAccountChecks() {
  if (!isSupabaseConfigured()) return 0;

  try {
    const removed = await supabaseDelete<{ game_id: string }>(TABLE, {
      filters: { expires_at: `lt.${new Date().toISOString()}` },
      prefer: "return=minimal",
    });
    return removed.length;
  } catch (error) {
    console.error("Account check cache purge failed", error);
    return 0;
  }
}