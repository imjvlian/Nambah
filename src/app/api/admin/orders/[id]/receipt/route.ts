import { authorizeAdminRequest } from "@/lib/admin-api";
import { deliverSuccessReceipt } from "@/lib/receipt-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  try {
    const result = await deliverSuccessReceipt(orderId);
    return Response.json({ result });
  } catch (error) {
    console.error("Admin receipt retry failed", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Receipt gagal dikirim ulang.",
      },
      { status: 502 },
    );
  }
}
