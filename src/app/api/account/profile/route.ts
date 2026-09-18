import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import {
  isValidIndonesianWhatsapp,
  normalizeReceiptWhatsapp,
} from "@/lib/customer-contact";
import {
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  whatsapp: string | null;
  preferred_receipt_channel: "email" | "whatsapp" | "both";
  created_at: string;
  updated_at: string;
};

async function authUser(request: Request) {
  const auth = await resolveNambahAuth(request);
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  appendResolvedNambahAuthCookies(headers, auth);
  return { auth, headers };
}

export async function GET(request: Request) {
  try {
    const { auth, headers } = await authUser(request);
    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const [profile] = await supabaseSelect<ProfileRow>("customer_profiles", {
      select:
        "user_id,display_name,whatsapp,preferred_receipt_channel,created_at,updated_at",
      filters: { user_id: "eq." + auth.user.id },
      limit: 1,
    });

    return Response.json(
      {
        profile: {
          displayName:
            profile?.display_name?.trim() ||
            auth.user.user_metadata?.display_name ||
            auth.user.email?.split("@")[0] ||
            "User Nambah",
          whatsapp: profile?.whatsapp ?? "",
          preferredReceiptChannel:
            profile?.preferred_receipt_channel ?? "email",
          updatedAt: profile?.updated_at ?? null,
        },
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Customer profile GET failed", error);
    return Response.json(
      { error: "Profil belum dapat dimuat." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { auth, headers } = await authUser(request);
    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const body = (await request.json()) as {
      displayName?: unknown;
      whatsapp?: unknown;
      preferredReceiptChannel?: unknown;
    };

    const displayName =
      typeof body.displayName === "string"
        ? body.displayName.trim().replace(/\s+/g, " ").slice(0, 80)
        : "";
    if (displayName.length < 2) {
      return Response.json(
        { error: "Nama minimal 2 karakter." },
        { status: 400, headers },
      );
    }

    const whatsapp = normalizeReceiptWhatsapp(body.whatsapp);
    if (whatsapp && !isValidIndonesianWhatsapp(whatsapp)) {
      return Response.json(
        { error: "Nomor WhatsApp tidak valid." },
        { status: 400, headers },
      );
    }

    const channel =
      body.preferredReceiptChannel === "whatsapp" ||
      body.preferredReceiptChannel === "both"
        ? body.preferredReceiptChannel
        : "email";

    const now = new Date().toISOString();
    await supabaseUpsert(
      "customer_profiles",
      {
        user_id: auth.user.id,
        display_name: displayName,
        whatsapp: whatsapp || null,
        preferred_receipt_channel: channel,
        updated_at: now,
      },
      {
        onConflict: "user_id",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );

    return Response.json(
      {
        profile: {
          displayName,
          whatsapp,
          preferredReceiptChannel: channel,
          updatedAt: now,
        },
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Customer profile PATCH failed", error);
    return Response.json(
      { error: "Profil gagal disimpan." },
      { status: 503 },
    );
  }
}
