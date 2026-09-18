import {
  getPointsSummary,
  maxRedeemablePointsForSubtotal,
  pointsToIdr,
  validateRequestedPoints,
} from "@/lib/loyalty";
import {
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { calculatePricing } from "@/lib/pricing";
import { getPricingContext } from "@/lib/pricing-repository";
import { toPublicPricing } from "@/lib/public-pricing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    gameId?: string;
    packageId?: string;
    paymentId?: string;
    promoCode?: string;
    referralCode?: string;
    pointsToRedeem?: number;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "Request checkout tidak valid." },
      { status: 400 },
    );
  }

  const auth = await resolveNambahAuth(request);
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  appendResolvedNambahAuthCookies(headers, auth);

  const pointsRequest = validateRequestedPoints(body.pointsToRedeem);
  if (!pointsRequest.ok) {
    return Response.json(
      { error: pointsRequest.error },
      { status: 400, headers },
    );
  }

  const result = await getPricingContext(body);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers },
    );
  }

  const {
    game,
    selectedPackage,
    paymentMethod,
    promotion,
    referral,
    minimumNambahProfit,
  } = result.context;

  const basePricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
  });

  let pointsSummary = null as Awaited<ReturnType<typeof getPointsSummary>> | null;
  let pointsDiscount = 0;

  if (auth.user) {
    pointsSummary = await getPointsSummary(auth.user.id);
  }

  if (pointsRequest.points > 0) {
    if (!auth.user || !pointsSummary) {
      return Response.json(
        { error: "Login diperlukan untuk menggunakan Nambah Points." },
        { status: 401, headers },
      );
    }

    if (pointsSummary.available < pointsRequest.points) {
      return Response.json(
        {
          error:
            "Nambah Points tersedia hanya " +
            pointsSummary.available +
            " points.",
          points: pointsSummary,
        },
        { status: 409, headers },
      );
    }

    const subtotalBeforePoints = Math.max(
      0,
      basePricing.sellingPrice -
        basePricing.promotionDiscount -
        basePricing.referralDiscount,
    );
    const maxPoints = maxRedeemablePointsForSubtotal(subtotalBeforePoints);
    if (pointsRequest.points > maxPoints) {
      return Response.json(
        {
          error:
            maxPoints > 0
              ? "Maksimum penggunaan untuk transaksi ini adalah " +
                maxPoints +
                " Nambah Points."
              : "Nambah Points belum dapat digunakan pada transaksi ini.",
          points: pointsSummary,
        },
        { status: 409, headers },
      );
    }

    pointsDiscount = pointsToIdr(pointsRequest.points);
  }

  const pricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
    pointsDiscount,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
  });

  return Response.json(
    {
      game,
      package: {
        id: selectedPackage.id,
        label: selectedPackage.label,
      },
      pricing: toPublicPricing(pricing),
      points: pointsSummary,
    },
    { headers },
  );
}
