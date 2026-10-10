import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  generateMerchantPin,
  hashMerchantPin,
} from "@/lib/merchant-pin";
import {
  getMerchantReceivables,
} from "@/lib/merchant-receivable";
import {
  isMerchantRetailEnabled,
  syncMerchantBalance,
} from "@/lib/merchant-retail";
import {
  supabaseInsert,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * CRUD merchant ritel.
 *
 * PIN kasir DIKEMBALIKAN SEKALI SAJA di respons pembuatan. Setelah itu
 * hanya hash-nya yang tersimpan dan TIDAK bisa dibaca kembali, termasuk oleh
 * admin. Ini bukan keterbatasan yang tidak sengaja - kalau PIN bisa dibaca
 * ulang, siapa pun yang bisa masuk ke panel ini (atau melakukan SQL dump)
 * otomatis punya akses ke konter.
 *
 * Kalau PIN hilang, reset lewat PATCH dan yang terjadi persis seperti
 * pembuatan: PIN baru dikembalikan sekali.
 */

type MerchantRow = {
  id: string;
  name: string;
  code: string;
  service_fee_flat_idr: number | string;
  payment_term_days: number;
  status: "active" | "frozen" | "inactive";
  notes: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const rows = await supabaseSelect<MerchantRow>("merchants", {
    select:
      "id,name,code,service_fee_flat_idr,payment_term_days,status,notes,created_at",
    order: "created_at.desc",
    limit: 200,
  });

  /*
   * Piutang diambil per merchant, bukan sekali lewat join.
   *
   * `supabaseSelect` adalah pembungkus PostgREST yang dipakai codebase ini
   * dan tidak mendukung nested select yang dalam. Kueri per merchant di sini
   * bisa lambat kalau nanti ada ratusan toko, tapi sekarang jumlahnya masih
   * sedikit, dan menambah join yang belum teruji berisiko lebih besar dari
   * kecepatannya.
   */
  const merchants = await Promise.all(
    rows.map(async (row) => {
      const receivables = await getMerchantReceivables(row.id);
      return {
        id: row.id,
        name: row.name,
        code: row.code,
        serviceFeeFlatIdr: Number(row.service_fee_flat_idr) || 0,
        paymentTermDays: Number(row.payment_term_days) || 7,
        status: row.status,
        notes: row.notes,
        createdAt: row.created_at,
        outstanding: receivables.outstanding,
        overdue: receivables.overdue,
        overdueCount: receivables.overdueCount,
        dueSoon: receivables.dueSoon,
        dueSoonCount: receivables.dueSoonCount,
      };
    }),
  );

  return Response.json({
    merchants,
    retailEnabled: isMerchantRetailEnabled(),
  });
}

export async function POST(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";

  /*
   * `code` adalah kredensial awal merchant DAN cara kasir masuk ke konter,
   * jadi formatnya dibatasi ketat: 4-16 karakter huruf-angka, tanpa spasi.
   * Alfabet dibatasi huruf besar saja supaya tidak ada kode yang berbeda
   * hanya karena besar-kecil huruf saat diketik di layar sentuh.
   */
  if (!/^[A-Z0-9]{4,16}$/.test(code)) {
    return Response.json(
      { error: "Kode toko harus 4-16 karakter huruf kapital atau angka." },
      { status: 400 },
    );
  }

  if (name.length < 2 || name.length > 120) {
    return Response.json(
      { error: "Nama toko harus 2-120 karakter." },
      { status: 400 },
    );
  }

  // Kode yang sudah dipakai membuat insert gagal dengan error database yang
  // tidak ramah. Dicek di sini supaya pesannya jelas.
  const existing = await supabaseSelect<{ id: string }>("merchants", {
    select: "id",
    filters: { code: `eq.${code}` },
    limit: 1,
  });
  if (existing.length > 0) {
    return Response.json(
      { error: `Kode toko ${code} sudah dipakai.` },
      { status: 409 },
    );
  }

  const pin = generateMerchantPin();

  const inserted = await supabaseInsert<MerchantRow>("merchants", {
    name,
    code,
    service_fee_flat_idr: normalizeFee(body.serviceFeeFlatIdr),
    payment_term_days: normalizeTerm(body.paymentTermDays),
    status: "active",
    notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    pin_hash: hashMerchantPin(pin),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (inserted.length === 0) {
    return Response.json(
      { error: "Gagal membuat toko. Periksa ulang data yang diisi." },
      { status: 500 },
    );
  }

  const merchant = inserted[0];

  // Audit sudah tidak melempar - `auditAdminAction` menolak sendiri kalau gagal.
  await auditAdminAction(request, {
    action: "merchant.create",
    targetType: "merchant",
    targetId: merchant.id,
    metadata: { code: merchant.code, name: merchant.name },
  });

  return Response.json(
    {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        code: merchant.code,
        serviceFeeFlatIdr: Number(merchant.service_fee_flat_idr) || 0,
        paymentTermDays: Number(merchant.payment_term_days) || 7,
        status: merchant.status,
      },
      /*
       * SATU-SATUNNYA tempat PIN pernah dikirim. Respons ini tidak disimpan
       * di mana pun dan tidak bisa diambil ulang - termasuk lewat GET.
       */
      pin,
      pinNotice:
        "Catat PIN ini sekarang. PIN tidak bisa dilihat lagi setelah halaman ini ditutup.",
    },
    { status: 201 },
  );
}

function normalizeFee(value: unknown): number {
  /*
   * Biaya layanan FLAT, dalam rupiah.
   *
   * Nilai tidak valid menjadi 0, bukan ditolak dengan 400. Alasannya: ini
   * field opsional di form, dan admin yang sedang memperbaiki satu toko
   * tidak boleh gagal menyimpan perubahan Termin atau status hanya karena
   * kolom fee belum terisi. `0` aman karena tidak menambah tagihan siapa pun.
   */
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  // Dibulatkan ke rupiah penuh. Pecahan rupiah tidak pernah dibayar dan
  // selalu jadi sumber salah kuitansi di konter.
  return Math.round(parsed);
}

function normalizeTerm(value: unknown): number {
  const parsed = Number(value);
  // Default 7 hari sesuai keputusan bisnis. Nilai di luar 1-90 ditolak
  // database, jadi nilai dipotong di sini supaya pesannya jelas.
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) return 7;
  return parsed;
}

/**
 * Ubah data merchant: tarif fee, termin, status, catatan, atau reset PIN.
 *
 * `code` SENGAJA TIDAK bisa diubah. Kode itu sudah tercetak di meja kasir dan
 * dipakai kasir untuk login; mengubahnya tanpa notice berarti semua kasir
 * tiba-tiba tidak bisa masuk.
 */
export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const merchantId = typeof body.id === "string" ? body.id.trim() : "";
  if (!merchantId) {
    return Response.json({ error: "ID toko wajib diisi." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.serviceFeePercent !== undefined) {
    patch.service_fee_flat_idr = normalizeFee(body.serviceFeeFlatIdr);
  }
  if (body.paymentTermDays !== undefined) {
    patch.payment_term_days = normalizeTerm(body.paymentTermDays);
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["pending", "active", "frozen", "inactive"].includes(status)) {
      return Response.json(
        { error: "Status harus pending, active, frozen, atau inactive." },
        { status: 400 },
      );
    }
    patch.status = status;
  }

  // Reset PIN. Bergabung dengan perubahan lain kalau keduanya dikirim
  // bersamaan - kasir biasanya reset PIN merchant yang salah ketik saat
  // sekalian memperbaiki tarifnya.
  let pin: string | null = null;
  if (body.resetPin === true) {
    pin = generateMerchantPin();
    patch.pin_hash = hashMerchantPin(pin);
  }

  const updated = await supabaseUpdate<MerchantRow>(
    "merchants",
    patch,
    { filters: { id: `eq.${merchantId}` } },
  );

  if (updated.length === 0) {
    return Response.json(
      { error: "Toko tidak ditemukan." },
      { status: 404 },
    );
  }

  // Balance di-refresh supaya angka di daftar tidak basi setelah tarif atau
  // status berubah.
  syncMerchantBalance(merchantId).catch((error) => {
    console.error(`Merchant balance refresh failed for ${merchantId}`, error);
  });

  await auditAdminAction(request, {
    action: pin ? "merchant.reset_pin" : "merchant.update",
    targetType: "merchant",
    targetId: merchantId,
    metadata: {
      changed: Object.keys(patch).filter((key) => key !== "updated_at"),
    },
  });

  return Response.json({
    merchant: {
      id: updated[0].id,
      name: updated[0].name,
      code: updated[0].code,
      serviceFeeFlatIdr: Number(updated[0].service_fee_flat_idr) || 0,
      paymentTermDays: Number(updated[0].payment_term_days) || 7,
      status: updated[0].status,
      notes: updated[0].notes,
    },
    ...(pin
      ? {
          pin,
          pinNotice:
            "Catat PIN baru ini sekarang. PIN tidak bisa dilihat lagi setelah halaman ini ditutup.",
        }
      : {}),
  });
}