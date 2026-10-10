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
import { readLinkReferralCode } from "@/lib/affiliate-link-cookie";
import { calculatePricing } from "@/lib/pricing";
import { getPricingContext } from "@/lib/pricing-repository";
import { toPublicPricing } from "@/lib/public-pricing";
import { MERCHANT_RETAIL_PAYMENT_METHOD_ID } from "@/lib/catalog";
import {
  getMerchantById,
  isMerchantRetailEnabled,
} from "@/lib/merchant-retail";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    gameId?: string;
    packageId?: string;
    paymentId?: string;
    promoCode?: string;
    referralCode?: string;
    pointsToRedeem?: number;
    merchantId?: string;
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

  const result = await getPricingContext({
    ...body,
    // Kode dari cookie, bukan dari body — client tidak boleh menentukan
    // affiliate-nya sendiri.
    linkCode: readLinkReferralCode(request),
    userId: auth.user?.id ?? null,
  });
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
    linkAffiliate,
    promoEndsAt,
    minimumNambahProfit,
  } = result.context;

  /*
   * Biaya layanan merchant.
   *
   *merchant WAJIB dipilih eksplisit untuk preview ini — kalau tidak ada
   * `merchantId`, fee-nya tidak boleh ditampilkan sebagai 0 karena itu akan
   * membuat total terlihat seperti tidak ada biaya sama sekali, dan user
   * baru tahu bedanya setelah order dibuat.
   *
   * Merchant yang tidak ada / tidak aktif / beku menghasilkan `null`, bukan
   * error, supaya pratinjau tetap bisa dihitung. `POST /api/orders` yang
   * menjadi gate terakhir dan menolak order-nya dengan pesan jelas.
   */
const isMerchantRetail = paymentMethod.id === MERCHANT_RETAIL_PAYMENT_METHOD_ID;
const merchant =
  isMerchantRetail && isMerchantRetailEnabled() && body.merchantId
    ? await getMerchantById(body.merchantId)
    : null;

const basePricing = calculatePricing({
    item: selectedPackage,
    paymentMethod,
    promotion,
    referral,

    linkAffiliate,
    loyaltyEligible: Boolean(auth.user),
    minimumNambahProfit,
    merchantServiceFeeFlat: merchant
      ? Number(merchant.service_fee_flat_idr ?? 0)
      : 0,
  });

  let pointsSummary = null as Awaited<ReturnType<typeof getPointsSummary>> | null;
  let pointsDiscount = 0;

  if (auth.user) {
    pointsSummary = await getPointsSummary(auth.user.id);
  }

  if (pointsRequest.points > 0) {
    if (!auth.user || !pointsSummary) {
      return Response.json(
        { error: "Login diperlukan untuk menggunakan Lacte Points." },
        { status: 401, headers },
      );
    }

    if (pointsSummary.available < pointsRequest.points) {
      return Response.json(
        {
          error:
            "Lacte Points tersedia hanya " +
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
                " Lacte Points."
              : "Lacte Points belum dapat digunakan pada transaksi ini.",
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
    // Sama seperti di `basePricing` di atas. Kalau fee hanya diteruskan di
    // panggilan pertama, pratinjau akan menunjukkan total TANPA biaya
    // layanan - user menekan tombol dengan angka yang salah, lalu menemukan
    // selisihnya di halaman order.
    merchantServiceFeeFlat: merchant ? Number(merchant.service_fee_flat_idr ?? 0) : 0,
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
      promoEndsAt,
    },
    { headers },
  );
}
