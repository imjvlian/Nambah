type SupabaseSelectOptions = {
  select: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
};

type SupabaseMutationOptions = {
  filters?: Record<string, string>;
  prefer?: string;
};

function getSupabaseConfig() {
  const url = (
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  )
    .trim()
    .replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";

  return { url, secretKey };
}

function requireSupabaseConfig() {
  const { url, secretKey } = getSupabaseConfig();
  if (!url || !secretKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }
  return { url, secretKey };
}

function createHeaders(secretKey: string, prefer?: string) {
  return {
    apikey: secretKey,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function applyFilters(query: URLSearchParams, filters?: Record<string, string>) {
  for (const [column, filter] of Object.entries(filters ?? {})) {
    query.set(column, filter);
  }
}

export function isSupabaseConfigured() {
  const { url, secretKey } = getSupabaseConfig();
  return Boolean(url && secretKey);
}

export async function supabaseSelect<T>(
  table: string,
  options: SupabaseSelectOptions,
): Promise<T[]> {
  const { url, secretKey } = requireSupabaseConfig();

  const query = new URLSearchParams();
  query.set("select", options.select);
  applyFilters(query, options.filters);

  if (options.order) query.set("order", options.order);
  if (options.limit !== undefined) query.set("limit", String(options.limit));

  const response = await fetch(`${url}/rest/v1/${table}?${query.toString()}`, {
    method: "GET",
    headers: createHeaders(secretKey),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} query failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T[];
}

export async function supabaseInsert<T>(
  table: string,
  body: Record<string, unknown> | Array<Record<string, unknown>>,
): Promise<T[]> {
  const { url, secretKey } = requireSupabaseConfig();

  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: createHeaders(secretKey, "return=representation"),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Supabase ${table} insert failed (${response.status}): ${responseBody}`);
  }

  return (await response.json()) as T[];
}

export async function supabaseUpdate<T>(
  table: string,
  body: Record<string, unknown>,
  options: SupabaseMutationOptions,
): Promise<T[]> {
  const { url, secretKey } = requireSupabaseConfig();
  const query = new URLSearchParams();
  applyFilters(query, options.filters);

  const response = await fetch(`${url}/rest/v1/${table}?${query.toString()}`, {
    method: "PATCH",
    headers: createHeaders(secretKey, options.prefer ?? "return=representation"),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Supabase ${table} update failed (${response.status}): ${responseBody}`);
  }

  return (await response.json()) as T[];
}
