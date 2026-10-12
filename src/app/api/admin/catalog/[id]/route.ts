import { authorizeAdminRequest } from "@/lib/admin-api";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProductRow = {
  id: string;
  label: string;
  note: string | null;
  selling_price: number | string;
  reference_price: number | string;
  active: boolean;
  internal_sku: string | null;
};

type UpdateProductBody = {
  label?: string;
  note?: string | null;
  sellingPrice?: number;
  referencePrice?: number;
  active?: boolean;
  internalSku?: string | null;
};

function validMoney(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const productId = id.trim();
  if (!productId) {
    return Response.json({ error: "Product ID tidak valid." }, { status: 400 });
  }

  let body: UpdateProductBody;
  try {
    body = (await request.json()) as UpdateProductBody;
  } catch {
    return Response.json({ error: "Request update produk tidak valid." }, { status: 400 });
  }

  try {
    const [existing] = await supabaseSelect<ProductRow>("products", {
      select: "id,label,note,internal_sku,selling_price,reference_price,active",
      filters: { id: `eq.${productId}` },
      limit: 1,
    });

    if (!existing) {
      return Response.json({ error: "Produk tidak ditemukan." }, { status: 404 });
    }

    const nextLabel = body.label === undefined ? existing.label : body.label.trim();
    const nextNote =
      body.note === undefined
        ? existing.note
        : body.note === null
          ? null
          : body.note.trim().slice(0, 120) || null;
    const nextSellingPrice =
      body.sellingPrice === undefined ? Number(existing.selling_price) : body.sellingPrice;
    const nextReferencePrice =
      body.referencePrice === undefined
        ? Number(existing.reference_price)
        : body.referencePrice;
    const nextActive = body.active === undefined ? existing.active : body.active;

    if (!nextLabel || nextLabel.length > 100) {
      return Response.json(
        { error: "Nama produk wajib diisi dan maksimal 100 karakter." },
        { status: 400 },
      );
    }

    if (!validMoney(nextSellingPrice) || nextSellingPrice <= 0) {
      return Response.json({ error: "Harga jual tidak valid." }, { status: 400 });
    }

    if (!validMoney(nextReferencePrice) || nextReferencePrice < nextSellingPrice) {
      return Response.json(
        { error: "Reference price harus sama atau lebih besar dari harga jual." },
        { status: 400 },
      );
    }

    /*
     * SKU internal: identitas milik Lacte, dijaga tetap unik oleh index
     * database. Validasi duplikat dilakukan DI SINI dengan pesan yang
     * jelas - kalau dibiarkan sampai 23505, operator hanya melihat
     * "Produk gagal diperbarui" tanpa tahu bahwa penyebabnya SKU
     * kembar.
     */
    let nextInternalSku = existing.internal_sku;
    if (body.internalSku !== undefined) {
      const diisi =
        body.internalSku === null ? null : body.internalSku.trim().toUpperCase();
      if (diisi === "") {
        return Response.json(
          { error: "SKU internal tidak boleh dikosongkan - kosongkan lewat generator saja." },
          { status: 400 },
        );
      }
      if (diisi && !/^[A-Z0-9_-]{3,120}$/.test(diisi)) {
        return Response.json(
          { error: "SKU internal hanya boleh huruf besar, angka, tanda hubung, dan garis bawah (3-120 karakter)." },
          { status: 400 },
        );
      }
      if (diisi && diisi !== existing.internal_sku) {
        const bentrok = await supabaseSelect<{ id: string; label: string }>("products", {
          select: "id,label",
          filters: { internal_sku: `eq.${diisi}` },
          limit: 1,
        });
        if (bentrok.length > 0) {
          return Response.json(
            {
              error: `SKU internal ${diisi} sudah dipakai produk "${bentrok[0].label}".`,
            },
            { status: 409 },
          );
        }
      }
      nextInternalSku = diisi;
    }

    const [updated] = await supabaseUpdate<ProductRow>(
      "products",
      {
        label: nextLabel,
        note: nextNote,
        selling_price: nextSellingPrice,
        reference_price: nextReferencePrice,
        active: nextActive,
        internal_sku: nextInternalSku,
        updated_at: new Date().toISOString(),
      },
      { filters: { id: `eq.${productId}` } },
    );

    return Response.json({
      product: {
        id: updated?.id ?? productId,
        label: updated?.label ?? nextLabel,
        note: updated?.note ?? nextNote,
        sellingPrice: Number(updated?.selling_price ?? nextSellingPrice),
        referencePrice: Number(updated?.reference_price ?? nextReferencePrice),
        active: updated?.active ?? nextActive,
        internalSku: updated?.internal_sku ?? nextInternalSku,
      },
    });
  } catch (error) {
    console.error("Admin product update failed", error);
    return Response.json({ error: "Produk gagal diperbarui." }, { status: 502 });
  }
}
