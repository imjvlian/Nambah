import {
  NambahAuthError,
  appendResolvedNambahAuthCookies,
  resolveNambahAuth,
} from "@/lib/nambah-auth";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Request affiliate dari sisi pembeli.
 *
 * Pisah dari `/api/account/affiliate` yang sudah ada: endpoint itu membaca
 * ringkasan affiliate untuk user yang SUDAH punya kode. Yang di sini untuk
 * orang yang belum punya dan ingin mendaftar.
 *
 * Commission rate TIDAK pernah diambil dari request. Nilai itu keputusan admin
 * saat menyetujui — supaya pembeli tidak bisa memilih komisi sendiri.
 */

type ExistingAffiliateRow = {
  code: string;
  status: string;
};

type RequestRow = {
  id: number;
  display_name: string;
  whatsapp: string;
  motivation: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  other_url: string;
  status: "pending" | "approved" | "rejected";
  granted_code: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

const WHATSAPP_PATTERN = /^(\+?62|0)8[1-9][0-9]{6,11}$/;

/** Batas per field, supaya satu link panjang tidak membanjiri panel review. */
const LINK_MAX_LENGTH = 300;

/**
 * Link dari form, dibersihkan.
 *
 * Dipotong ke `LINK_MAX_LENGTH`, bukan DITOLAK kalau kelewat panjang. Untuk
 * field opsional seperti ini, memotong lebih baik daripada membatalkan seluruh
 * request — pemohon tidak akan menolak seluruh pengajuannya hanya karena
 * satu field kelewat panjang.
 */
function readLink(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  return value.slice(0, LINK_MAX_LENGTH);
}

function authHeaders(headers: Headers) {
  headers.set("Cache-Control", "private, no-store");
  return headers;
}

export async function GET(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = authHeaders(new Headers());
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    // Sudah punya affiliate? Tidak boleh request kedua.
    const [existing] = await supabaseSelect<ExistingAffiliateRow>("affiliates", {
      select: "code,status",
      filters: { user_id: `eq.${auth.user.id}` },
      limit: 1,
    });
    if (existing) {
      return Response.json(
        {
          alreadyAffiliate: true,
          code: existing.code,
          status: existing.status,
          request: null,
        },
        { headers },
      );
    }

    const [existingRequest] = await supabaseSelect<RequestRow>(
      "affiliate_requests",
      {
        select:
          "id,display_name,whatsapp,motivation,instagram,tiktok,youtube,other_url,status,granted_code,rejection_reason,created_at,updated_at",
        filters: { user_id: `eq.${auth.user.id}` },
        limit: 1,
      },
    );

    return Response.json(
      {
        alreadyAffiliate: false,
        request: existingRequest
          ? {
              id: existingRequest.id,
              displayName: existingRequest.display_name,
              whatsapp: existingRequest.whatsapp,
              motivation: existingRequest.motivation,
              instagram: existingRequest.instagram,
              tiktok: existingRequest.tiktok,
              youtube: existingRequest.youtube,
              otherUrl: existingRequest.other_url,
              status: existingRequest.status,
              grantedCode: existingRequest.granted_code,
              rejectionReason: existingRequest.rejection_reason,
              createdAt: existingRequest.created_at,
              updatedAt: existingRequest.updated_at,
            }
          : null,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      { error: "Request tidak dapat diproses." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveNambahAuth(request);
    const headers = authHeaders(new Headers());
    appendResolvedNambahAuthCookies(headers, auth);

    if (!auth.user) {
      return Response.json({ error: "Login diperlukan." }, { status: 401, headers });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (displayName.length < 3 || displayName.length > 80) {
      return Response.json(
        { error: "Nama tampilan wajib 3-80 karakter." },
        { status: 400, headers },
      );
    }

    // WhatsApp dipakai admin untuk menghubungi applicant. Wajib — tanpa itu
    // request yang tertinggal tidak ada yang bisa ditindaklanjuti.
    const whatsapp =
      typeof body.whatsapp === "string"
        ? body.whatsapp.replace(/[\s-]/g, "").trim()
        : "";
    if (!WHATSAPP_PATTERN.test(whatsapp)) {
      return Response.json(
        { error: "WhatsApp tidak valid. Gunakan format 08xx atau +62xx." },
        { status: 400, headers },
      );
    }

    // Alasan. Wajib karena affiliate adalah orang yang mengarahkan
    // traffic, bukan akun kosong.
    const motivation =
      typeof body.motivation === "string" ? body.motivation.trim() : "";
    if (motivation.length < 20 || motivation.length > 1000) {
      return Response.json(
        { error: "Ceritakan channel kamu, minimal 20 karakter." },
        { status: 400, headers },
      );
    }

    // Link channel. Tidak wajib semuanya, tapi minimal satu harus terisi.
    //
    // Instagram sengaja TIDAK dijadikan wajib: affiliate yang hanya punya
    // channel Telegram tetap sah, dan memaksa Instagram akan menyaring orang
    // yang justru aktif jualan.
    const instagram = readLink(body, "instagram");
    const tiktok = readLink(body, "tiktok");
    const youtube = readLink(body, "youtube");
    const otherUrl = readLink(body, "otherUrl");

    if (!instagram && !tiktok && !youtube && !otherUrl) {
      return Response.json(
        { error: "Isi minimal satu link channel kamu." },
        { status: 400, headers },
      );
    }

    const [existing] = await supabaseSelect<ExistingAffiliateRow>("affiliates", {
      select: "code,status",
      filters: { user_id: `eq.${auth.user.id}` },
      limit: 1,
    });
    if (existing) {
      return Response.json(
        { error: "Akun ini sudah punya kode affiliate." },
        { status: 409, headers },
      );
    }

    // `user_id` unik di tabel, jadi `upsert` aman: request kedua untuk akun
    // yang sama akan memperbarui, bukan menggandakan baris.
    const now = new Date().toISOString();
    const rows = await supabaseUpsert<RequestRow>(
      "affiliate_requests",
      {
        user_id: auth.user.id,
        display_name: displayName,
        whatsapp,
        motivation,
        instagram,
        tiktok,
        youtube,
        other_url: otherUrl,
        status: "pending",
        // Request yang diperbarui kembali ke antrean. Kalau sebelumnya ditolak
        // dan applicant mengubah alasan, admin perlu menilai ulang.
        granted_code: null,
        commission_rate: null,
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
        created_at: now,
        updated_at: now,
      },
      {
        onConflict: "user_id",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );

    const row = rows[0];
    return Response.json(
      {
        request: row
          ? {
              id: row.id,
              displayName: row.display_name,
              whatsapp: row.whatsapp,
              motivation: row.motivation,
              instagram: row.instagram,
              tiktok: row.tiktok,
              youtube: row.youtube,
              otherUrl: row.other_url,
              status: row.status,
              grantedCode: row.granted_code,
              rejectionReason: row.rejection_reason,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }
          : null,
      },
      { status: 201, headers },
    );
  } catch (error) {
    if (error instanceof NambahAuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json(
      { error: "Request tidak dapat diproses." },
      { status: 500 },
    );
  }
}
