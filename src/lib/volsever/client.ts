const VOLSEVER_GAME_BASE_URL = "https://gate.volsever.com/proxy/api/game";
const VOLSEVER_TIMEOUT_MS = 12_000;

type VolseverPayload = {
  status?: boolean;
  code?: number;
  message?: string;
  data?: {
    game?: string | null;
    username?: string | null;
    nickname?: string | null;
    user_id?: string | number | null;
    zone?: string | number | null;
    server?: string | number | null;
    region?: string | null;
    country?: string | null;
    country_code?: string | null;
  } | null;
};

export type VolseverCheckResult = {
  ok: boolean;
  configured: boolean;
  httpStatus: number;
  retryable: boolean;
  invalidAccount: boolean;
  message: string;
  nickname: string | null;
  server: string | null;
  region: string | null;
  countryCode: string | null;
};

const REGION_MAP: Record<string, { region: string; countryCode: string | null }> = {
  ID: { region: "Indonesia", countryCode: "ID" },
  IND: { region: "Indonesia", countryCode: "ID" },
  SG: { region: "Singapore", countryCode: "SG" },
  MY: { region: "Malaysia", countryCode: "MY" },
  TH: { region: "Thailand", countryCode: "TH" },
  VN: { region: "Vietnam", countryCode: "VN" },
  PH: { region: "Philippines", countryCode: "PH" },
  PK: { region: "Pakistan", countryCode: "PK" },
  BD: { region: "Bangladesh", countryCode: "BD" },
  TW: { region: "Taiwan", countryCode: "TW" },
  BR: { region: "Brazil", countryCode: "BR" },
  US: { region: "United States", countryCode: "US" },
  NA: { region: "North America", countryCode: null },
  LATAM: { region: "Latin America", countryCode: null },
  EU: { region: "Europe", countryCode: null },
  EUROPE: { region: "Europe", countryCode: null },
  RU: { region: "Russia / CIS", countryCode: "RU" },
  CIS: { region: "Russia / CIS", countryCode: null },
  ME: { region: "Middle East / North Africa", countryCode: null },
  MENA: { region: "Middle East / North Africa", countryCode: null },
};

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizeRegion(
  explicitRegion: unknown,
  explicitCountry: unknown,
  explicitCountryCode: unknown,
  gameName: unknown,
) {
  const countryCodeRaw = normalizeText(explicitCountryCode).toUpperCase();
  const regionRaw = normalizeText(explicitRegion) || normalizeText(explicitCountry);
  const regionKey = regionRaw.toUpperCase();

  if (countryCodeRaw && REGION_MAP[countryCodeRaw]) {
    return REGION_MAP[countryCodeRaw];
  }

  if (regionKey && REGION_MAP[regionKey]) {
    return REGION_MAP[regionKey];
  }

  if (regionRaw) {
    return {
      region: regionRaw,
      countryCode: countryCodeRaw || null,
    };
  }

  const normalizedGameName = normalizeText(gameName).toLowerCase();
  if (/\bindonesia\b/.test(normalizedGameName)) {
    return { region: "Indonesia", countryCode: "ID" };
  }

  return { region: null, countryCode: countryCodeRaw || null };
}

export function isVolseverConfigured() {
  return Boolean(process.env.VOLSEVER_API_KEY?.trim());
}

export async function checkVolseverGame(input: {
  routeSlug: string;
  userId: string;
  serverId?: string;
}): Promise<VolseverCheckResult> {
  const apiKey = process.env.VOLSEVER_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      httpStatus: 0,
      retryable: false,
      invalidAccount: false,
      message: "Volsever API key belum dikonfigurasi.",
      nickname: null,
      server: input.serverId ?? null,
      region: null,
      countryCode: null,
    };
  }

  if (!/^[a-z0-9-]+$/i.test(input.routeSlug)) {
    throw new Error("Invalid Volsever route slug");
  }

  const url = new URL(`${VOLSEVER_GAME_BASE_URL}/${input.routeSlug}`);
  url.searchParams.set("id", input.userId);
  if (input.serverId) url.searchParams.set("zone", input.serverId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOLSEVER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: VolseverPayload = {};
    try {
      payload = raw ? (JSON.parse(raw) as VolseverPayload) : {};
    } catch {
      return {
        ok: false,
        configured: true,
        httpStatus: response.status,
        retryable: true,
        invalidAccount: false,
        message: "Response Volsever tidak dapat dibaca.",
        nickname: null,
        server: input.serverId ?? null,
        region: null,
        countryCode: null,
      };
    }

    const nickname = normalizeText(payload.data?.username ?? payload.data?.nickname) || null;
    const server = normalizeText(payload.data?.zone ?? payload.data?.server) || input.serverId || null;
    const normalizedRegion = normalizeRegion(
      payload.data?.region,
      payload.data?.country,
      payload.data?.country_code,
      payload.data?.game,
    );

    if (response.ok && payload.status !== false && nickname) {
      return {
        ok: true,
        configured: true,
        httpStatus: response.status,
        retryable: false,
        invalidAccount: false,
        message: payload.message?.trim() || "ID Found",
        nickname,
        server,
        region: normalizedRegion.region,
        countryCode: normalizedRegion.countryCode,
      };
    }

    const invalidAccount = response.status === 400 || response.status === 404;
    const retryable = response.status === 429 || response.status >= 500;

    return {
      ok: false,
      configured: true,
      httpStatus: response.status,
      retryable,
      invalidAccount,
      message:
        payload.message?.trim() ||
        (invalidAccount
          ? "User ID / Server tidak ditemukan."
          : "Volsever tidak dapat memverifikasi akun."),
      nickname,
      server,
      region: normalizedRegion.region,
      countryCode: normalizedRegion.countryCode,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        configured: true,
        httpStatus: 0,
        retryable: true,
        invalidAccount: false,
        message: "Volsever timeout.",
        nickname: null,
        server: input.serverId ?? null,
        region: null,
        countryCode: null,
      };
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
