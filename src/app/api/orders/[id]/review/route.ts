import { readOrderAccessToken } from "@/lib/order-access";
import {
  resolveReviewEligibility,
  submitReview,
} from "@/lib/reviews";

export const runtime = "nodejs";

/**
 * GET  -> apakah order ini boleh diulas + ulasan yang sudah ada
 * POST -> menyimpan atau mengubah ulasan
 *
 * Kedua aksi butuh bukti kepemilikan order (access token). Tanpa itu-route ini
 * mengembalikan 401, jadi orang tidak bisa menilai order orang lain hanya
 * dengan menebak id-nya.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = readOrderAccessToken(request);

  if (!token) {
    return Response.json({ error: "Akses order tidak ditemukan." }, { status: 401 });
  }

  const eligibility = await resolveReviewEligibility(id, token);
  if (eligibility.reason === "unauthorized") {
    return Response.json({ error: "Akses order tidak valid." }, { status: 401 });
  }

  return Response.json({
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    productId: eligibility.productId,
    productLabel: eligibility.productLabel,
    review: eligibility.review,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = readOrderAccessToken(request);

  if (!token) {
    return Response.json({ error: "Akses order tidak ditemukan." }, { status: 401 });
  }

  let body: { rating?: unknown; comment?: unknown } = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: "Data ulasan tidak valid." }, { status: 400 });
  }

  const result = await submitReview(id, request, {
    rating: body.rating,
    comment: body.comment,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ ok: true, review: result.review });
}