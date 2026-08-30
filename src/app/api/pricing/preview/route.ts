import { games, paymentMethods } from "@/lib/catalog";
import { calculatePricing, findPromotion } from "@/lib/pricing";
import { toPublicPricing } from "@/lib/public-pricing";
import { findReferral } from "@/lib/referrals";
import { attachSupplierCost } from "@/lib/supplier-pricing";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    gameId?: string;
    packageId?: string;
    paymentId?: string;
    promoCode?: string;
    referralCode?: string;
  };

  const game = games.find((item) => item.id === body.gameId);
  const selectedPackage = game?.packages.find((item) => item.id === body.packageId);
  const paymentMethod = paymentMethods.find((item) => item.id === body.paymentId);

  if (!game || !selectedPackage || !paymentMethod) {
    return Response.json(
      { error: "Produk atau metode pembayaran tidak valid." },
      { status: 400 },
    );
  }

  const supplierPricedPackage = attachSupplierCost(selectedPackage);
  if (!supplierPricedPackage) {
    return Response.json(
      { error: "Harga supplier untuk produk ini belum tersedia." },
      { status: 503 },
    );
  }

  const promoCode = body.promoCode?.trim().toUpperCase() ?? "";
  const promotion = promoCode ? findPromotion(promoCode) : null;

  if (promoCode && !promotion) {
    return Response.json({ error: "Kode promo tidak ditemukan." }, { status: 400 });
  }

  const referralCode = body.referralCode?.trim().toUpperCase() ?? "";
  const referral = referralCode ? findReferral(referralCode) : null;

  if (referralCode && !referral) {
    return Response.json({ error: "Kode referral tidak ditemukan." }, { status: 400 });
  }

  const pricing = calculatePricing({
    item: supplierPricedPackage,
    paymentMethod,
    promotion,
    referral,
  });

  return Response.json({
    game: {
      id: game.id,
      name: game.name,
    },
    package: {
      id: selectedPackage.id,
      label: selectedPackage.label,
    },
    pricing: toPublicPricing(pricing),
  });
}
