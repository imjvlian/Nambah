import { readOrderAccessToken, verifyOrderAccess } from "@/lib/order-access";
import { supabaseInsert, supabaseSelect, supabaseUpsert } from "@/lib/supabase/server";

/**
 * Rating & ulasan produk.
 *
 * Aturan utama: hanya pemilik order yang sudah `success` bisa menulis, dan
 * produknya selalu diambil dari `orders.product_id` — bukan dari request klien.
 * Dengan begitu tidak mungkin ada rating untuk produk yang tidak dibeli, dan
 * tidak ada transaksi rating yang fabricated.
 */

export type ReviewRow = {
  id: number;
  order_id: string;
  product_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

/** Status order yang mengizinkan ulasan. `processing` belum — barang belum sampai. */
const REVIEWABLE_STATUSES = new Set(["success"]);

export const MAX_COMMENT_LENGTH = 400;

export type ReviewEligibility = {
  eligible: boolean;
  reason:
    | "ok"
    | "unauthorized"
    | "order-not-found"
    | "order-not-finished"
    | "missing-order-access";
  productId: string | null;
  productLabel: string | null;
  review: { rating: number; comment: string | null; createdAt: string } | null;
};

/**
 * Pesan penolakan yang aman ditampilkan ke pengguna.
 */
const ELIGIBILITY_MESSAGE: Record<ReviewEligibility["reason"], string> = {
  ok: "",
  unauthorized: "Kamu tidak punya akses ke order ini.",
  "order-not-found": "Order tidak ditemukan.",
  "order-not-finished": "Ulasan bisa diberikan setelah transaksi selesai.",
  "missing-order-access": "Buka halaman order dari link yang kamu terima untuk memberi ulasan.",
};

export async function resolveReviewEligibility(
  orderId: string,
  token: string,
): Promise<ReviewEligibility> {
  const empty: ReviewEligibility = {
    eligible: false,
    reason: "missing-order-access",
    productId: null,
    productLabel: null,
    review: null,
  };

  if (!orderId || !token) return empty;

  if (!(await verifyOrderAccess(orderId, token))) {
    return { ...empty, reason: "unauthorized" };
  }

  const [order] = await supabaseSelect<{
    id: string;
    product_id: string;
    status: string;
  }>("orders", {
    select: "id,product_id,status",
    filters: { id: `eq.${orderId}` },
    limit: 1,
  });

  if (!order) return { ...empty, reason: "order-not-found" };

  const [product] = await supabaseSelect<{ id: string; label: string }>("products", {
    select: "id,label",
    filters: { id: `eq.${order.product_id}` },
    limit: 1,
  });

  const [existing] = await supabaseSelect<ReviewRow>("product_reviews", {
    select: "id,order_id,product_id,rating,comment,created_at,updated_at",
    filters: { order_id: `eq.${orderId}` },
    limit: 1,
  });

  const review = existing
    ? {
        rating: Number(existing.rating),
        comment: existing.comment,
        createdAt: existing.created_at,
      }
    : null;

  if (!REVIEWABLE_STATUSES.has(order.status)) {
    return {
      eligible: false,
      reason: "order-not-finished",
      productId: order.product_id,
      productLabel: product?.label ?? null,
      review,
    };
  }

  return {
    eligible: true,
    reason: "ok",
    productId: order.product_id,
    productLabel: product?.label ?? null,
    review,
  };
}

export function reviewEligibilityMessage(reason: ReviewEligibility["reason"]) {
  return ELIGIBILITY_MESSAGE[reason] ?? ELIGIBILITY_MESSAGE["order-not-finished"];
}

export type SubmitReviewInput = {
  rating: unknown;
  comment: unknown;
};

export type SubmitReviewResult =
  | { ok: true; review: { rating: number; comment: string | null; createdAt: string } }
  | { ok: false; error: string };

export async function submitReview(
  orderId: string,
  request: Request,
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  const token = readOrderAccessToken(request);
  const eligibility = await resolveReviewEligibility(orderId, token);

  if (!eligibility.eligible || !eligibility.productId) {
    return { ok: false, error: reviewEligibilityMessage(eligibility.reason) };
  }

  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Rating harus berupa angka 1 sampai 5." };
  }

  const rawComment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (rawComment.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Ulasan maksimal ${MAX_COMMENT_LENGTH} karakter.`,
    };
  }

  const now = new Date().toISOString();

  // Upsert by order_id: satu order hanya boleh punya satu ulasan, dan
  // mengeditnya diperbolehkan tanpa menggandakan suara.
  const [saved] = await supabaseUpsert<ReviewRow>(
    "product_reviews",
    {
      order_id: orderId,
      product_id: eligibility.productId,
      rating,
      comment: rawComment.length > 0 ? rawComment : null,
      updated_at: now,
    },
    { onConflict: "order_id" },
  );

  return {
    ok: true,
    review: {
      rating: Number(saved?.rating ?? rating),
      comment: saved?.comment ?? null,
      createdAt: saved?.created_at ?? now,
    },
  };
}

export type ProductRatingSummary = {
  average: number | null;
  total: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  highlights: Array<{ rating: number; comment: string; createdAt: string }>;
};

/**
 * Agregat rating untuk seluruh produk dalam satu game — dipakai halaman
 * produk supaya cukup satu permintaan, bukan satu per nominal.
 *
 * `product_reviews` tidak menyimpan game_id, jadi produk diambil lebih dulu.
 * Filter `in.()` dipecah per 200 id supaya URL tidak melewati batas PostgREST
 * (game terbesar punya ratusan produk).
 */
export async function getGameRatingSummary(
  gameId: string,
  options?: { topProductsLimit?: number; highlightsLimit?: number },
): Promise<{
  average: number | null;
  total: number;
  distribution: ProductRatingSummary["distribution"];
  topProducts: Array<{
    productId: string;
    label: string;
    average: number;
    total: number;
  }>;
  highlights: Array<{
    rating: number;
    comment: string;
    createdAt: string;
    productLabel: string;
  }>;
}> {
  const distribution: ProductRatingSummary["distribution"] = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };

  const products = await supabaseSelect<{ id: string; label: string }>("products", {
    select: "id,label",
    filters: { game_id: `eq.${gameId}` },
    order: "id.asc",
  });

  if (products.length === 0) {
    return { average: null, total: 0, distribution, topProducts: [], highlights: [] };
  }

  const labelById = new Map(products.map((product) => [product.id, product.label]));

  const reviews: ReviewRow[] = [];
  for (const chunk of chunkArray(products.map((product) => product.id), 200)) {
    reviews.push(
      ...(await supabaseSelect<ReviewRow>("product_reviews", {
        select: "id,order_id,product_id,rating,comment,created_at,updated_at",
        filters: { product_id: `in.(${chunk.join(",")})` },
        order: "created_at.desc",
        limit: 1000,
      })),
    );
  }

  reviews.sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );

  let sum = 0;
  const perProduct = new Map<string, { sum: number; count: number }>();

  for (const review of reviews) {
    const rating = Number(review.rating);
    if (rating < 1 || rating > 5) continue;

    distribution[String(rating) as keyof typeof distribution] += 1;
    sum += rating;

    const bucket = perProduct.get(review.product_id) ?? { sum: 0, count: 0 };
    bucket.sum += rating;
    bucket.count += 1;
    perProduct.set(review.product_id, bucket);
  }

  const topProducts = [...perProduct.entries()]
    .map(([productId, bucket]) => ({
      productId,
      label: labelById.get(productId) ?? productId,
      average: Math.round((bucket.sum / bucket.count) * 10) / 10,
      total: bucket.count,
    }))
    .sort((left, right) => right.average - left.average || right.total - left.total)
    .slice(0, options?.topProductsLimit ?? 5);

  const highlights = reviews
    .filter((review) => review.comment && review.comment.trim().length > 0)
    .slice(0, options?.highlightsLimit ?? 5)
    .map((review) => ({
      rating: Number(review.rating),
      comment: review.comment!.trim(),
      createdAt: review.created_at,
      productLabel: labelById.get(review.product_id) ?? review.product_id,
    }));

  return {
    average: reviews.length > 0 ? Math.round((sum / reviews.length) * 10) / 10 : null,
    total: reviews.length,
    distribution,
    topProducts,
    highlights,
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Agregat rating publik untuk satu produk (tanpa data pelanggan). */
export async function getProductRatingSummary(
  productId: string,
  options?: { highlightsLimit?: number },
): Promise<ProductRatingSummary> {
  const distribution: ProductRatingSummary["distribution"] = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };

  const reviews = await supabaseSelect<ReviewRow>("product_reviews", {
    select: "id,rating,comment,created_at",
    filters: { product_id: `eq.${productId}` },
    order: "created_at.desc",
    limit: 1000,
  });

  let sum = 0;
  for (const review of reviews) {
    const rating = Number(review.rating);
    if (rating >= 1 && rating <= 5) {
      distribution[String(rating) as keyof typeof distribution] += 1;
      sum += rating;
    }
  }

  const highlights = reviews
    .filter((review) => review.comment && review.comment.trim().length > 0)
    .slice(0, options?.highlightsLimit ?? 5)
    .map((review) => ({
      rating: Number(review.rating),
      comment: review.comment!.trim(),
      createdAt: review.created_at,
    }));

  return {
    average: reviews.length > 0 ? Math.round((sum / reviews.length) * 10) / 10 : null,
    total: reviews.length,
    distribution,
    highlights,
  };
}