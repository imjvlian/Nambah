import {
  authorizeAdminRequest,
  getAdminRequestPrincipal,
} from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  confirmRefundCompletedForOrder,
  getRefundForOrder,
  processRefundForOrder,
  rejectRefundForOrder,
  requestRefundForOrder,
  type RefundRow,
} from "@/lib/refund-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  let body: { reason?: unknown; requestNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request refund tidak valid." }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason : "";
  const requestNote =
    typeof body.requestNote === "string" ? body.requestNote.slice(0, 500) : null;

  const principal = getAdminRequestPrincipal(request);

  try {
    /*
     * Satu tombol Refund untuk dua situasi:
     * - Belum ada permintaan → buat baris refund baru.
     * - Customer sudah mengajukan dari halaman order (status requested)
     *   atau percobaan sebelumnya gagal (status failed) → proses baris
     *   yang sudah ada. Admin tidak boleh terjebak 409 hanya karena
     *   customer mengajukan duluan.
     */
    let refundRow: RefundRow;
    let mode: "auto" | "manual";
    let origin: "admin" | "existing-request";

    const created = await requestRefundForOrder({
      orderId,
      reason,
      requestedByAdminUserId: principal?.userId ?? null,
      requestNote,
    });

    if (created.ok) {
      refundRow = created.refund;
      mode = created.mode;
      origin = "admin";
    } else {
      const existing = await getRefundForOrder(orderId);
      if (
        !existing ||
        (existing.status !== "requested" && existing.status !== "failed")
      ) {
        return Response.json(
          { error: created.error },
          { status: created.status },
        );
      }
      refundRow = existing;
      mode = existing.provider === "manual" ? "manual" : "auto";
      origin = "existing-request";
    }

    await auditAdminAction(request, {
      action: "refund.request",
      targetType: "order",
      targetId: orderId,
      metadata: {
        refundId: refundRow.id,
        provider: refundRow.provider,
        amount: Number(refundRow.amount),
        reason: refundRow.reason,
        mode,
        origin,
      },
    });

    if (mode === "manual") {
      return Response.json(
        {
          refund: refundRow,
          mode: "manual",
          message:
            "Refund ini harus diproses manual lewat Merchant Support. Setelah transfer dikonfirmasi, tandai selesai dari inspector order.",
        },
        { status: 202 },
      );
    }

    const processed = await processRefundForOrder(orderId);
    if (!processed.ok) {
      return Response.json(
        { error: processed.error },
        { status: processed.status },
      );
    }

    await auditAdminAction(request, {
      action: "refund.process",
      targetType: "order",
      targetId: orderId,
      metadata: {
        refundId: processed.refund.id,
        provider: processed.refund.provider,
        amount: Number(processed.refund.amount),
        status: processed.refund.status,
      },
    });

    return Response.json({ refund: processed.refund, mode: "auto" });
  } catch (error) {
    console.error("Admin refund failed", orderId, error);
    return Response.json(
      { error: "Refund gagal diproses. Cek log untuk detail." },
      { status: 502 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request, { superadminOnly: true });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orderId = decodeURIComponent(id).trim();
  if (!orderId) {
    return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  }

  let body: { action?: unknown; reason?: unknown; completedNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Request refund tidak valid." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const completedNote =
    typeof body.completedNote === "string" ? body.completedNote.slice(0, 500) : null;

  const principal = getAdminRequestPrincipal(request);

  try {
    if (action === "confirm-completed") {
      const result = await confirmRefundCompletedForOrder({
        orderId,
        confirmedByAdminUserId: principal?.userId ?? null,
        completedNote,
      });

      if (!result.ok) {
        return Response.json({ error: result.error }, { status: result.status });
      }

      await auditAdminAction(request, {
        action: "refund.confirm_completed",
        targetType: "order",
        targetId: orderId,
        metadata: {
          refundId: result.refund.id,
          amount: Number(result.refund.amount),
          completedNote,
        },
      });

      return Response.json({ refund: result.refund, mode: "confirmed" });
    }

    if (action === "reject") {
      const result = await rejectRefundForOrder({
        orderId,
        rejectedByAdminUserId: principal?.userId ?? null,
        reason,
      });

      if (!result.ok) {
        return Response.json({ error: result.error }, { status: result.status });
      }

      await auditAdminAction(request, {
        action: "refund.reject",
        targetType: "order",
        targetId: orderId,
        metadata: {
          refundId: result.refund.id,
          reason,
        },
      });

      return Response.json({ refund: result.refund });
    }

    return Response.json({ error: "Aksi refund tidak valid." }, { status: 400 });
  } catch (error) {
    console.error("Admin refund action failed", orderId, error);
    return Response.json(
      { error: "Aksi refund gagal diproses. Cek log untuk detail." },
      { status: 502 },
    );
  }
}
