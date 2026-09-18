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

  if (!/^[A-Za-z0-9@._+|:\-]+$/.test(target)) {
    throw new Error(
      "customer_no hasil format mengandung karakter yang tidak diizinkan.",
    );
  }

  return {
    customerNo: target,
    allowDot: target.includes("."),
  };
}
