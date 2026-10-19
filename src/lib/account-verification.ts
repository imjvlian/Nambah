import { getGameAccountSchema } from "@/lib/game-account";
import {
  readCachedAccountCheck,
  writeCachedAccountCheck,
} from "@/lib/account-check-cache";
import {
  checkMelostoreNickname,
  checkMelostorePurchaseLimit,
  isMelostoreConfigured,
  type MelostoreCheckUnavailableReason,
} from "@/lib/suppliers/melostore-client";
import {
  getMelostoreGameCode,
  isResidualUnverifiableGame,
  melostoreCodeRequiresZone,
} from "@/lib/melostore-game-codes";
import { decideMlbbLimitForClass } from "@/lib/account-verification-policy";
import { classifyLimitedItem } from "@/lib/purchase-limit-ux";
import type {
  AccountVerificationResult,
  AccountVerificationUnavailableReason,
} from "@/lib/account-verification-policy";
import type { AccountVerificationMode } from "@/lib/account-verification-settings";
import { enqueueTelegramMessage, isTelegramConfigured } from "@/lib/telegram";

/**
 * Engine gerbang verifikasi akun untuk checkout.
 *
 * Urutan keputusannya berlapis, dari yang paling murah ke yang paling mahal:
 *
 *   1. mode `off`           -> skip total, tidak menyentuh apa pun.
 *   2. tanpa checker        -> voucher/pulsa/tagihan: tidak punya konsep
 *                              nickname, `not_required` tanpa alarm.
 *   3. residual (5 game)    -> `not_required` TANPA alarm — diterima
 *                              tertulis (keputusan owner 17 Okt 2026).
 *   4. tanpa pemetaan       -> `not_required` + alarm mapping-gap — fail
 *                              open, tapi readiness menampilkannya supaya
 *                              tidak jadi lubang senyap.
 *   5. mismatch zone        -> Melostore minta zone, form Nambah tidak
 *                              mengumpulkannya -> fail-open + alarm gap.
 *   6. belum dikonfigurasi -> `not_configured` + alarm (keputusan 1:
 *                              fail-open, satu env kosong tidak boleh
 *                              mematikan seluruh game).
 *   7. cache 24 jam         -> hit berarti terverifikasi (provider kolomnya
 *                              bisa volsever/mimih dari cek UI — bukti
 *                              nickname sama validnya).
 *   8. Melostore            -> baru sekarang jatah cek dibakar.
 *
 * MLBB JALUR KHUSUS: selalu lewat `purchase-limit`, tidak pernah lewat
 * cache — cache hanya menyimpan "nickname valid", bukan status weekly
 * pass. Kalau MLBB boleh cache-hit, kontrol limit bisa dilewati dengan
 * order ulang. Konsekuensinya: order MLBB dengan user unik selalu
 * membayar satu cek (dalam batas 40 gratis/hari).
 *
 * Fungsi ini TIDAK PERNAH melempar. Setiap jalur gagal menjadi hasil
 * `unavailable`/`not_required` — policy-nya yang memutuskan allow/block.
 */

const MLBB_GAME_ID = "mobile-legends";

function nowIso() {
  return new Date().toISOString();
}

function notRequired(
  alarm?: AccountVerificationResult["alarm"],
  gapNote?: string | null,
): AccountVerificationResult {
  return {
    status: "not_required",
    provider: null,
    nickname: null,
    region: null,
    checkedAt: null,
    ...(alarm ? { alarm } : {}),
    ...(gapNote ? { gapNote } : {}),
  };
}

/**
 * Alarm 402 — kondisi keuangan, bukan provider down. Tanpa alarm ini,
 * saldo cek yang habis menjadi outage senyap: semua order enforce
 * ditolak 503 tanpa ada yang tahu kenapa.
 *
 * Dedupe per jam (pola notifyOrderStuck): cukup satu pesan per jam,
 * tidak pernah banjir.
 */
async function alertInsufficientBalance(gameId: string) {
  if (!isTelegramConfigured()) return;

  const hourBucket = Math.floor(Date.now() / 3_600_000);
  try {
    await enqueueTelegramMessage(
      "<b>Saldo cek nickname Melostore habis</b>\nGate verifikasi menolak order (503) karena saldo check-nickname tidak cukup. Isi saldo di dashboard Melostore, atau turunkan mode gate sementara lewat panel admin.",
      {
        kind: "ops",
        dedupeKey: `account-verification:insufficient-balance:${hourBucket}`,
        payload: { gameId },
      },
    );
  } catch (error) {
    console.error(
      "[account-verification] alarm saldo habis gagal dikirim",
      error,
    );
  }
}

function unavailableResult(
  reason: AccountVerificationUnavailableReason | MelostoreCheckUnavailableReason,
  gameId: string,
): AccountVerificationResult {
  const result: AccountVerificationResult = {
    status: "unavailable",
    provider: "melostore",
    nickname: null,
    region: null,
    checkedAt: nowIso(),
    reason: reason as AccountVerificationUnavailableReason,
  };

  if (reason === "insufficient-balance") {
    result.alarm = "insufficient-balance";
    void alertInsufficientBalance(gameId);
  }

  return result;
}

export async function verifyOrderAccount(input: {
  gameId: string;
  gameName: string;
  gameShortName: string;
  requiresServer: boolean;
  userId: string;
  serverId?: string | null;
  supplierSku?: string | null;
  mode: AccountVerificationMode;
}): Promise<AccountVerificationResult> {
  if (input.mode === "off") {
    return {
      status: "skipped",
      provider: null,
      nickname: null,
      region: null,
      checkedAt: null,
    };
  }

  // (2) Voucher/pulsa/tagihan tidak punya konsep nickname.
  const schema = getGameAccountSchema({
    id: input.gameId,
    name: input.gameName,
    shortName: input.gameShortName,
    requiresServer: input.requiresServer,
  });
  if (!schema.checker) {
    return notRequired();
  }

  // (3) + (4) Pemetaan Melostore.
  const code = getMelostoreGameCode(input.gameId);
  if (!code) {
    if (isResidualUnverifiableGame(input.gameId)) {
      return notRequired();
    }
    console.warn(
      `[account-verification] game "${input.gameId}" belum punya pemetaan Melostore — order fail-open. Tambahkan ke src/lib/melostore-game-codes.ts.`,
    );
    return notRequired("mapping-gap", `unmapped:${input.gameId}`);
  }

  // (5) Melostore minta zone, tapi form Nambah tidak mengumpulkannya.
  if (melostoreCodeRequiresZone(code) && !input.serverId) {
    console.warn(
      `[account-verification] code "${code}" menuntut zone, tapi form Nambah untuk "${input.gameId}" tidak mengumpulkannya — order fail-open.`,
    );
    return notRequired("mapping-gap", `zone-mismatch:${input.gameId}`);
  }

  // (6) Fail-open + alarm (keputusan 1).
  if (!isMelostoreConfigured()) {
    console.warn(
      "[account-verification] MELOSTORE_API_KEY / MELOSTORE_SECRET_KEY belum diisi — gate fail-open. Lihat /api/admin/readiness.",
    );
    return {
      status: "not_configured",
      provider: null,
      nickname: null,
      region: null,
      checkedAt: null,
      alarm: "not-configured",
    };
  }

  try {
    // (7 khusus MLBB) purchase-limit, bukan cache — lihat komentar header.
    if (input.gameId === MLBB_GAME_ID) {
      const result = await checkMelostorePurchaseLimit({
        userId: input.userId,
        zoneId: input.serverId ?? "",
      });

      if (result.outcome === "verified") {
        /*
         * Alias SKU → kelas limit (19 Okt 2026): SKU katalog Melostore
         * (mlidwp/mlidwdp2d/mlid100d/mlid…dd) TIDAK sama dengan package
         * code respons purchase-limit (weekly-pass, double-diamonds-50) —
         * pencocokan langsung lama tidak pernah aktif untuk mapping
         * nyata. Klasifikasi menerjemahkan dulu, lalu keputusan keluarga
         * memutuskan. Kelas non-supplier (consent/riwayat) bukan urusan
         * gate — itu lapisan UX pra-pembelian.
         */
        const cls = classifyLimitedItem({
          gameId: input.gameId,
          supplierSku: input.supplierSku ?? null,
          label: null,
        });

        const decision =
          cls &&
          (cls.kind === "supplier-weekly-pass" ||
            cls.kind === "supplier-double-diamonds")
            ? decideMlbbLimitForClass({
                cls,
                weeklyPass: result.weeklyPass,
                doubleDiamonds: result.doubleDiamonds,
                doubleDiamondsEligible: result.doubleDiamondsEligible,
              })
            : { ok: true as const };

        /*
         * Data limit ikut masuk cache (kolom purchase_limit, migrasi 056)
         * untuk SEMUA hasil verified — termasuk yang akhirnya
         * limit_blocked. Dengan begitu popup & banner 0.9a membacanya
         * gratis, dan kasus seperti xeesoxee tidak perlu cek kedua untuk
         * tahu status WDP-nya.
         */
        try {
          await writeCachedAccountCheck({
            gameId: input.gameId,
            userId: input.userId,
            serverId: input.serverId,
            nickname: result.username,
            region: result.region,
            provider: "melostore",
            purchaseLimit: {
              weeklyPass: result.weeklyPass,
              doubleDiamonds: result.doubleDiamonds,
              doubleDiamondsEligible: result.doubleDiamondsEligible,
            },
          });
        } catch (error) {
          console.error(
            "[account-verification] cache write gagal — verifikasi tetap valid",
            error,
          );
        }

        if (!decision.ok) {
          return {
            status: "limit_blocked",
            provider: "melostore",
            nickname: result.username,
            region: result.region,
            checkedAt: nowIso(),
            limitReason: decision.reason,
          };
        }

        return {
          status: "verified",
          provider: "melostore",
          nickname: result.username,
          region: result.region,
          checkedAt: nowIso(),
        };
      }

      if (result.outcome === "invalid") {
        return {
          status: "invalid",
          provider: "melostore",
          nickname: null,
          region: null,
          checkedAt: nowIso(),
        };
      }

      return unavailableResult(result.reason, input.gameId);
    }

    // (7) Cache 24 jam — dipakai bersama route cek akun UI.
    const cached = await readCachedAccountCheck(
      input.gameId,
      input.userId,
      input.serverId,
    );
    if (cached) {
      return {
        status: "verified",
        provider: cached.provider,
        nickname: cached.nickname,
        region: cached.region,
        checkedAt: nowIso(),
      };
    }

    // (8) Baru sekarang jatah cek Melostore dibakar.
    const result = await checkMelostoreNickname({
      gameCode: code,
      userId: input.userId,
      zoneId: input.serverId ?? null,
    });

    if (result.outcome === "verified") {
      try {
        await writeCachedAccountCheck({
          gameId: input.gameId,
          userId: input.userId,
          serverId: input.serverId,
          nickname: result.username,
          region: result.region,
          provider: "melostore",
        });
      } catch (error) {
        console.error(
          "[account-verification] cache write gagal — verifikasi tetap valid",
          error,
        );
      }

      return {
        status: "verified",
        provider: "melostore",
        nickname: result.username,
        region: result.region,
        checkedAt: nowIso(),
      };
    }

    if (result.outcome === "invalid") {
      return {
        status: "invalid",
        provider: "melostore",
        nickname: null,
        region: null,
        checkedAt: nowIso(),
      };
    }

    return unavailableResult(result.reason, input.gameId);
  } catch (error) {
    console.error(
      "[account-verification] kegagalan tak terduga — diperlakukan sebagai gangguan provider",
      error,
    );
    return unavailableResult("provider-error", input.gameId);
  }
}
