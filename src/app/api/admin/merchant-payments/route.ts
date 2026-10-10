import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import { recordMerchantPayment } from "@/lib/merchant-payment";

export const runtime = "nodejs";

/**
 * Catat pelunasan merchant.
 *
 * Hanya admin yang boleh memanggil route ini: nominal yang masuk di sini
 * mengubah posisi kas Lacte secara langsung. `auditAdminAction` mencatat siapa
 * yang mencatat, berapa, dan untuk toko mana - jadi ada jejak kalau ada
 * pelunasan fiktif yang membuat piutang hilang.
 *
 * Response sengaja mengembalikan `credit` (sisa bayar) karena admin harus
 * tahu kalau transfer yang dicatat lebih besar dari piutang. Menyembunyikannya
 * akan membuat admin mengira ada piutang yang tersisa padahal uangnya sudah
 * ada di Lacte.
 */
export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const merchantId =
    typeof body.merchantId === "string" ? body.merchantId.trim() : "";
  if (!merchantId) {
    return Response.json({ error: "ID merchant wajib diisi." }, { status: 400 });
  }

  try {
    const result = await recordMerchantPayment({
      merchantId,
      amount: body.amount as number | string,
      method: body.method as "transfer" | "cash" | "other" | undefined,
      reference: typeof body.reference === "string" ? body.reference : null,
      note: typeof body.note === "string" ? body.note : null,
      recordedBy: auth.principal.userId,
    });

    await auditAdminAction(request, {
      action: "merchant.payment.record",
      targetType: "merchant",
      targetId: merchantId,
      metadata: {
        amount: result.amount,
        applied: result.applied,
        credit: result.credit,
        settledCount: result.settledCount,
        paymentId: result.paymentId,
      },
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Pencatatan pelunasan merchant gagal.";

    // Pesan dari `normalizeAmount` aman dikirim ke admin: itu input yang
    // salah, bukan kebocoran internal.
    const isInputError =
      /wajib diisi|harus berupa angka bulat positif|tidak ditemukan/i.test(message);

    if (!isInputError) {
      console.error("Record merchant payment failed", error);
    }

    return Response.json(
      { error: message },
      { status: isInputError ? 400 : 500 },
    );
  }
}