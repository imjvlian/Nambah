export type FulfillmentTargetInput = {
  userId: string;
  serverId?: string | null;
  requiresServer?: boolean;
};

const ALLOWED_PLACEHOLDERS = new Set(["user_id", "server_id"]);

export function renderFulfillmentTarget(
  template: string,
  input: FulfillmentTargetInput,
) {
  const normalizedTemplate = template.trim();
  if (!normalizedTemplate) {
    throw new Error("Fulfillment target template belum dikonfigurasi.");
  }

  const placeholders = Array.from(
    normalizedTemplate.matchAll(/\{([a-z_]+)\}/g),
  ).map((match) => match[1]);

  if (placeholders.length === 0 || !placeholders.includes("user_id")) {
    throw new Error(
      "Fulfillment target template wajib memiliki {user_id}.",
    );
  }

  const unsupported = placeholders.find(
    (placeholder) => !ALLOWED_PLACEHOLDERS.has(placeholder),
  );
  if (unsupported) {
    throw new Error(
      "Fulfillment target template memiliki placeholder yang tidak didukung: {" +
        unsupported +
        "}.",
    );
  }

  if (
    (input.requiresServer || placeholders.includes("server_id")) &&
    !input.serverId
  ) {
    throw new Error(
      "Server / Zone wajib tersedia untuk format fulfillment produk ini.",
    );
  }

  if (input.requiresServer && !placeholders.includes("server_id")) {
    throw new Error(
      "Produk membutuhkan server tetapi template tidak memiliki {server_id}.",
    );
  }

  const target = normalizedTemplate
    .replaceAll("{user_id}", input.userId.trim())
    .replaceAll("{server_id}", input.serverId?.trim() ?? "");

  if (target.length < 3 || target.length > 128) {
    throw new Error("customer_no hasil format berada di luar batas aman.");
  }

  // Karakter yang diizinkan di `customer_no`:
  //   `#`   Riot ID Valorant/LoL (Nama#Tag)
  //   `|`   pemisah "Format no tujuan [UID]|[Server]" — Dragon Nest M, HSR
  //   `,`   pemisah "Format tujuan : User ID,Server" — Heroes Evolved, NBA Infinite
  //   `@`   email (Xbox, voucher)
  //   `/`   region "TW/HK/MO" — Genshin, Zenless Zone Zero
  //   ` `   nama server Ragnarok M: "Eternal Love", "Memory of Faith", dll
  //
  // Semua ini ditambahkan karena nama region/server yang sah, bukan karakter
  // nakal. Tanpa `,` setiap order Heroes Evolved dan NBA Infinite gagal di
  // menit terakhir; tanpa `/` dan spasi, memilih "TW/HK/MO" di Genshin atau
  // server mana pun di Ragnarok M tidak bisa dikirim.
  //
  // Yang tetap DITOLAK: kutip, backslash, titik koma, kurung siku, dan
  // karakter kontrol. Ada testnya di `tests/fulfillment-target.test.ts`.
  if (!/^[A-Za-z0-9@._+|,#:\-\/ ]+$/.test(target)) {
    throw new Error(
      "customer_no hasil format mengandung karakter yang tidak diizinkan.",
    );
  }

  return {
    customerNo: target,
    allowDot: target.includes("."),
  };
}
