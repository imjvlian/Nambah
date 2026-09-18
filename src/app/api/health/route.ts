import { getFulfillmentMode } from "@/lib/fulfillment";
import { isFlowTestMode } from "@/lib/flow-test";
import {
  isSupabaseConfigured,
  supabaseSelect,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  let database = false;
  if (isSupabaseConfigured()) {
    try {
      await supabaseSelect<{ id: string }>("games", {
        select: "id",
        limit: 1,
      });
      database = true;
    } catch {
      database = false;
    }
  }

  const services = {
    database,
    midtrans: configured("MIDTRANS_SERVER_KEY"),
    digiflazz:
      configured("DIGIFLAZZ_USERNAME") &&
      configured("DIGIFLAZZ_API_KEY"),
    brevo:
      process.env.BREVO_RECEIPT_ENABLED?.trim().toLowerCase() === "true"
        ? configured("BREVO_API_KEY") &&
          configured("BREVO_SENDER_EMAIL")
        : true,
  };

  return Response.json(
    {
      status: database ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      flowTest: isFlowTestMode(),
      fulfillmentMode: getFulfillmentMode(),
      services,
    },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
