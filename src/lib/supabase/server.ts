type SupabaseSelectOptions = {
  select: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
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

export function isSupabaseConfigured() {
  const { url, secretKey } = getSupabaseConfig();
  return Boolean(url && secretKey);
}

export async function supabaseSelect<T>(
  table: string,
  options: SupabaseSelectOptions,
): Promise<T[]> {
  const { url, secretKey } = getSupabaseConfig();

  if (!url || !secretKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }

  const query = new URLSearchParams();
  query.set("select", options.select);

  for (const [column, filter] of Object.entries(options.filters ?? {})) {
    query.set(column, filter);
  }

  if (options.order) query.set("order", options.order);
  if (options.limit !== undefined) query.set("limit", String(options.limit));

  const response = await fetch(`${url}/rest/v1/${table}?${query.toString()}`, {
    method: "GET",
    headers: {
      apikey: secretKey,
      Accept: "application/json",
      "Accept-Profile": "public",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} query failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T[];
}
