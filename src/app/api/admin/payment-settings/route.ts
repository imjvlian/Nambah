import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  getActivePaymentProvider,
  getPaymentProviderStatuses,
  isPaymentProviderId,
  setActivePaymentProvider,
} from "@/lib/payment-settings";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const activeProvider = await getActivePaymentProvider();
  return Response.json({
    activeProvider,
    providers: getPaymentProviderStatuses(),
    settingsReady: isSupabaseConfigured(),
  });
}

export async function PATCH(request: Request) {
  // Switch gateway mengatur aliran uang order baru — superadmin saja.
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { provider?: unknown };
    if (!isPaymentProviderId(body.provider)) {
      return Response.json(
        { error: "Provider harus midtrans atau doku." },
        { status: 400 },
      );
    }

    // Proteksi: jangan izinkan switch ke gateway yang env-nya belum terisi —
    // checkout order baru akan gagal total.
    const statuses = getPaymentProviderStatuses();
    const target = statuses.find((status) => status.id === body.provider);
    if (target && !target.configured) {
      return Response.json(
        {
          error: `${target.name} belum terkonfigurasi di server (${target.note}). Isi environment-nya dulu sebelum mengalihkan gateway.`,
        },
        { status: 409 },
      );
    }

    const previous = await getActivePaymentProvider();
    await setActivePaymentProvider(body.provider);

    await auditAdminAction(request, {
      action: "payment.provider.switch",
      targetType: "payment_settings",
      targetId: "active_payment_provider",
      metadata: { from: previous, to: body.provider },
    });

    return Response.json({
      activeProvider: body.provider,
      providers: getPaymentProviderStatuses(),
    });
  } catch (error) {
    console.error("Payment settings PATCH failed", error);
    return Response.json(
      { error: "Gateway pembayaran gagal dialihkan." },
      { status: 502 },
    );
  }
}
