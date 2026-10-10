/**
 * Memantau order uji sampai piutangnya tercatat.
 *
 * Menjalankan:
 *   node scripts/check-receivable.mjs
 *
 * `receivable_due_at` hanya terisi setelah fulfillment SUDAH sukses, bukan
 * setelah kasir memindai. Keduanya berbeda waktu: memindai berarti Lacte
 * mengirim top up ke supplier dan menanggung biayanya; piutang baru lahir
 * setelah supplier menyatakan berhasil.
 *
 * Jadi order yang statusnya masih `processing` normal - bukan bug.
 */

import fs from "fs";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...loadEnv(".env") };
const SUPA = env.SUPABASE_URL;
const KEYY = env.SUPABASE_SECRET_KEY;

async function get(path) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: { apikey: KEYY, Authorization: `Bearer ${KEYY}`, Accept: "application/json" },
  });
  return JSON.parse(await res.text());
}

const orderId = process.argv[2];
const query = orderId
  ? "orders?id=eq." + orderId
  : "orders?merchant_id=not.is.null&status=eq.success&receivable_paid_at=is.null&order=created_at.desc";

const rows = await get(
  query + "&select=id,status,final_price,service_fee_amount,service_fee_flat_snapshot,merchant_scan_code,fulfilled_at,receivable_due_at,terminal_at&order=created_at.desc&limit=8",
);

if (!rows.length) {
  console.log("Tidak ada order yang cocok.");
  console.log("");
  console.log("Kalau order-nya masih diproses supplier, `receivable_due_at`");
  console.log("memang belum terisi. Jalankan ulang beberapa saat lagi.");
  process.exit(0);
}

for (const row of rows) {
  console.log(
    (orderId ? "" : "") +
      row.id +
      "  [" + row.status + "]  kode=" + (row.merchant_scan_code ?? "-"),
  );
  console.log("   total dibayar pembeli : Rp" + Number(row.final_price).toLocaleString("id-ID"));
  console.log("   biaya layanan toko   : Rp" + Number(row.service_fee_amount ?? 0).toLocaleString("id-ID"));
  console.log("   snapshot fee         : Rp" + Number(row.service_fee_flat_snapshot ?? 0).toLocaleString("id-ID"));
  console.log("   supplier selesai     : " + (row.fulfilled_at ?? "belum"));
  console.log("   piutang jatuh tempo  : " + (row.receivable_due_at ?? "BELUM TERISI"));
  console.log("");
}

console.log("Catatan: piutang terisi hanya setelah status SUCCESS.");
console.log("Kalau masih PROCESSING, fulfillment ke supplier belum selesai -");
console.log("itu normal, bukan bug. Periksa lagi beberapa saat lagi.");