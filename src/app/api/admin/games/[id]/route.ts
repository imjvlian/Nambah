import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Toggle maintenance per game (P3.1).
 *
 * Satu tombol menutup SEMUA SKU game itu: etalase menyembunyikan
 * produk-produknya, dan gate order menolak checkout dengan pesan jujur
 * (halaman produk bisa masih ke-cache di browser pelanggan).
 *
 * Sengaja PATCH terpisah, bukan bagian dari body produk: maintenance
 * game adalah keputusan menit-menit saat gangguan supplier ("game ini
 * matik semua dulu"), dan harus bisa ditekan tanpa menyentuh apa pun
 * yang lain.
 *
 * `maintenance` terpisah dari `active` - active dimiliki sinkronisasi
 * katalog, maintenance dimiliki admin murni dan sifatnya sementara.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const gameId = id.trim();
  if (!gameId) {
    return Response.json({ error: "Game ID tidak valid." }, { status: 400 });
  }

  let body: { maintenance?: unknown };
  try {
    body = (await request.json()) as { maintenance?: unknown };
  } catch {
    return Response.json(
      { error: "Request update game tidak valid." },
      { status: 400 },
    );
  }

  if (typeof body.maintenance !== "boolean") {
    return Response.json(
      { error: "Field maintenance harus true atau false." },
      { status: 400 },
    );
  }

  try {
    const [existing] = await supabaseSelect<{
      id: string;
      name: string;
      short_name: string;
      active: boolean;
      maintenance: boolean;
    }>("games", {
      select: "id,name,short_name,active,maintenance",
      filters: { id: `eq.${gameId}` },
      limit: 1,
    });

    if (!existing) {
      return Response.json({ error: "Game tidak ditemukan." }, { status: 404 });
    }

    const [updated] = await supabaseUpdate<{
      id: string;
      maintenance: boolean;
    }>(
      "games",
      {
        maintenance: body.maintenance,
        updated_at: new Date().toISOString(),
      },
      { filters: { id: `eq.${gameId}` } },
    );

    await auditAdminAction(request, {
      action: "catalog.game.maintenance",
      targetType: "game",
      targetId: gameId,
      metadata: {
        name: existing.name,
        maintenance: {
          from: existing.maintenance,
          to: body.maintenance,
        },
      },
    });

    return Response.json({
      game: {
        id: updated?.id ?? gameId,
        name: existing.name,
        shortName: existing.short_name,
        active: existing.active,
        maintenance: updated?.maintenance ?? body.maintenance,
      },
    });
  } catch (error) {
    console.error("Admin game maintenance toggle failed", gameId, error);
    return Response.json(
      { error: "Status maintenance game gagal disimpan." },
      { status: 502 },
    );
  }
}
