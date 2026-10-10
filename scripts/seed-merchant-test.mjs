/**
 * Persiapan uji end-to-end jalur merchant ritel.
 *
 * Menjalankan:
 *   node scripts/seed-merchant-test.mjs
 *
 * Membuat satu merchant `active` dengan PIN yang diketahui, dan menyalakan
 * `payment_methods.merchant_retail`.
 *
 * Kenapa skrip ini ada, dan bukan "SQL di SQL Editor":
 * PIN hanya tersedia SEKALI saat toko dibuat atau di-reset. Kalau harus
 * membuat toko lewat panel admin lalu_constant PIN-nya di layar, menguji
 * alur kasir berarti menyalin PIN secara manual ke setiap terminal -
 * lambat, dan prone salah ketik. Pin yang sudah diketahui di sini membuat
 * setiap uji bisa dijalankan ulang tanpa langkah manual.
 *
 * TIDAK menyentuh order. Order harus dibuat lewat checkout sungguhan,
 * supaya yang diuji adalah alur yang benar-benar dipakai pelanggan.
 */

import fs from "fs";
import { createHash, randomBytes, scryptSync } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

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
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;

if (!URL || !KEY) {
  console.error("SUPABASE_URL / SUPABASE_SECRET_KEY tidak ditemukan di .env.local");
  process.exit(1);
}

/**
 * Panggilan REST ke PostgREST.
 *
 * `query` dikirim sebagai parameter terpisah, bukan digabung ke `path`.
 * PostgREST hanya menerima satu `?`; menggabungkan keduanya membuat
 * `select` ikut diberi parameter tambahan dan query gagal di parser.
 */
async function rest(method, table, filters, body) {
  const query = new URLSearchParams(filters);
  const url = `${URL}/rest/v1/${table}${query.toString() ? "?" + query : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${table} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : [];
}

function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

const CODE = "TOKOTEST";
const PIN = "112233";

async function main() {
  // 1. Nyalakan metode pembayaran ritel di checkout.
  await rest("PATCH", "payment_methods", { id: "eq.merchant_retail" }, { active: true });
  console.log("payment_methods.merchant_retail -> active = true");

  // 2. Buat atau perbarui merchant uji.
  const existing = await rest("GET", "merchants", {
    code: "eq." + CODE,
    select: "id,name,status",
  });

  const now = new Date().toISOString();
  const payload = {
    name: "Toko Uji Ritel",
    code: CODE,
    address: "Jl. Uji No. 1, Jakarta",
    contact: "081234567890",
    service_fee_flat_idr: 2000,
    payment_term_days: 7,
    status: "active",
    notes: "Dibuat oleh scripts/seed-merchant-test.mjs",
    pin_hash: hashPin(PIN),
    updated_at: now,
  };

  if (existing.length > 0) {
    await rest("PATCH", "merchants", { id: "eq." + existing[0].id }, payload);
    console.log("merchant diperbarui: " + CODE + " (" + existing[0].id + ")");
  } else {
    const created = await rest("POST", "merchants", {}, { ...payload, created_at: now });
    console.log("merchant dibuat: " + CODE + " (" + created[0].id + ")");
  }

  console.log("");
  console.log("=== KREDENSIAL KASIR ===");
  console.log("Kode toko : " + CODE);
  console.log("PIN kasir : " + PIN);
  console.log("Fee       : Rp2.000 per pesanan");
  console.log("Termin    : 7 hari");
  console.log("");
  console.log("Lanjut: set MERCHANT_RETAIL_ENABLED=true, lalu buka /merchant/kasir");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});