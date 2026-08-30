import { calculatePricing } from "@/lib/pricing";
import { getPricingContext } from "@/lib/pricing-repository";
import { toPublicPricing } from "@/lib/public-pricing";

export async function POST(request: Request) {
  let body: {
    gameId?: string;
    packageId?: string;
    paymentId?: string;
    promoCode?: string;
    referralCode?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request checkout tidak valid." }, { status: 400 });
  }

  const result = await getPricingContext(body);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const {
    game,
    selectedPackage,
    paymentMethod,
    promotion,
    referral,
    minimumNambahProfit,
  } = result.context;

  const pricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,
    minimumNambahProfit,
  });

  return Response.json({
    game,
    package: {
      id: selectedPackage.id,
      label: selectedPackage.label,
    },
    pricing: toPublicPricing(pricing),
  });
}
