/**
 * Uji end-to-end jalur merchant ritel, lewat HTTP ke dev server.
 *
 * Menjalankan:
 *   1. npm run dev
 *   2. node scripts/e2e-merchant.mjs
 *
 * Menguji seluruh rantai nyata: checkout -> kode pindai -> lookup kasir ->
 * confirm. Tidak menyentuh database langsung, karena yang sedang diuji
 * justru lapisan-lapis itu.
 *
 * Isi env untuk base URL dan kredensial kasir ada di file yang sama.
 */

import fs from "fs";

const BASE = (process.env.MERCHANT_TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const CODE = process.env.MERCHANT_TEST_CODE || "TOKOTEST";
const PIN = process.env.MERCHANT_TEST_PIN || "112233";

// Satu game + paket yang aktif di katalog produksi.
const GAME_ID = process.env.MERCHANT_TEST_GAME_ID || "";
const PACKAGE_ID = process.env.MERCHANT_TEST_PACKAGE_ID || "";

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

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log("  OK    " + label);
  } else {
    failed += 1;
    console.log("  GAGAL " + label + (detail ? "  -> " + detail : ""));
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: { apikey: KEYY, Authorization: `Bearer ${KEYY}`, Accept: "application/json" },
  });
  return JSON.parse(await res.text());
}

async function main() {
  console.log("Target: " + BASE);
  console.log("");

  if (!process.env.MERCHANT_RETAIL_ENABLED) {
    console.log("PERINGATAN: MERCHANT_RETAIL_ENABLED tidak diset di shell ini.");
    console.log("Server tetap dipakai yang menentukan - pastikan sudah true.");
    console.log("");
  }

  // --- 1. Catalog -----------------------------------------------------------
  console.log("1. Cari game dan paket untuk diuji");

  let gameId = GAME_ID;
  let packageId = PACKAGE_ID;

  if (!gameId || !packageId) {
    const games = await supabaseGet(
      "games?active=eq.true&select=id,name,short_name,requires_server&limit=1",
    );
    if (!games.length) {
      console.log("  GAGAL tidak ada game aktif");
      process.exit(1);
    }
    gameId = gameId || games[0].id;

    const packages = await supabaseGet(
      "products?game_id=eq." + gameId + "&active=eq.true&select=id,label,selling_price&limit=1",
    );
    if (!packages.length) {
      console.log("  GAGAL tidak ada produk aktif untuk game " + gameId);
      process.exit(1);
    }
    packageId = packageId || packages[0].id;
  }

  console.log("  game    : " + gameId);
  console.log("  paket   : " + packageId);

  // --- 2. Cek daftar toko publik --------------------------------------------
  console.log("\n2. GET /api/merchants");
  const list = await fetch(BASE + "/api/merchants");
  const listData = await list.json();
  check("daftar toko merespons 200", list.status === 200, "status " + list.status);
  const visible = (listData.merchants || []).find((m) => m.name.includes("Uji"));
  check("toko uji muncul di checkout", Boolean(visible));
  check("kode toko TIDAK ikut terkirim", !JSON.stringify(listData).includes(CODE),
    "kode toko bocor ke browser");
  check("PIN TIDAK ikut terkirim", !JSON.stringify(listData).includes(PIN));

  // --- 3. Preview harga dengan fee ------------------------------------------
  console.log("\n3. POST /api/pricing/preview (merchant_retail)");
  const merchants = await supabaseGet("merchants?code=eq." + CODE + "&select=id,name,service_fee_flat_idr");
  if (!merchants.length) {
    console.log("  GAGAL merchant " + CODE + " tidak ada. Jalankan seed-merchant-test.mjs");
    process.exit(1);
  }
  const merchant = merchants[0];
  const expectedFee = Number(merchant.service_fee_flat_idr);
  console.log("  fee merchant: Rp" + expectedFee);

  const preview = await post("/api/pricing/preview", {
    gameId,
    packageId,
    paymentId: "merchant_retail",
    merchantId: merchant.id,
  });
  check("preview merespons 200", preview.status === 200, JSON.stringify(preview.data).slice(0, 200));

  const pricing = preview.data.pricing;
  if (pricing) {
    console.log("  fee di preview: Rp" + pricing.merchantServiceFee);
    console.log("  total di preview: Rp" + pricing.finalPrice);
    check("fee flat terbaca di preview", pricing.merchantServiceFee === expectedFee,
      "dapat " + pricing.merchantServiceFee + ", harusnya " + expectedFee);
    check("total = harga - diskon + fee", pricing.finalPrice > pricing.sellingPrice);
  }

  // --- 4. Order merchant -----------------------------------------------------
  console.log("\n4. POST /api/orders (path ritel)");
  const order = await post("/api/orders", {
    gameId,
    packageId,
    paymentId: "merchant_retail",
    merchantId: merchant.id,
    // Untuk game voucher (Google Play, Steam, PSN) kolom "akun" diisi email
    // atau nomor HP, bukan User ID. Skema账号 diambil dari game, jadi nilai
    // di sini harus cocok dengan game yang dipilih di atas.
    targetUserId: "081234567890",
    targetServerId: "",
    // Tamu tanpa login tetap butuh email DAN nomor HP. example.com
    // ditolak validator email, jadi pakai domain yang lolos.
    receiptEmail: "e2e.lacte@gmail.com",
    receiptWhatsapp: "081234567890",
  });
  check("order dibuat", order.status === 201, JSON.stringify(order.data).slice(0, 250));

  const orderId = order.data.order?.id;
  if (!orderId) {
    console.log("\nGagal membuat order - tidak bisa lanjut.");
    process.exit(1);
  }
  console.log("  order: " + orderId);

  const rows = await supabaseGet(
    "orders?id=eq." + orderId +
      "&select=id,status,merchant_id,merchant_scan_code,service_fee_flat_snapshot,service_fee_amount,final_price,expires_at",
  );
  const row = rows[0] || {};

  check("status = pending_merchant", row.status === "pending_merchant", "dapat " + row.status);
  check("merchant_id tersimpan", row.merchant_id === merchant.id);
  // Format: prefix MR, lalu 6 karakter dipisah jadi 3-3. Regex sebelumnya
  // mengharuskan tanda hubung SETELAH 2 karakter, yang tidak pernah terjadi.
  check("kode pindai dibuat", /^MR[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/.test(row.merchant_scan_code || ""),
    "kode = " + JSON.stringify(row.merchant_scan_code));
  check("snapshot fee tersimpan", Number(row.service_fee_flat_snapshot) === expectedFee,
    "dapat " + row.service_fee_flat_snapshot);
  check("nominal fee tersimpan", Number(row.service_fee_amount) === expectedFee,
    "dapat " + row.service_fee_amount);
  check("expiry 2 jam (bukan 30 menit)", Boolean(row.expires_at));

  const scanCode = row.merchant_scan_code;
  console.log("  kode pindai: " + scanCode);

  // --- 5. Lookup kasir -------------------------------------------------------
  console.log("\n5. POST /api/merchant/lookup");

  const wrongPin = await post("/api/merchant/lookup", { code: CODE, pin: "999999", orderCode: scanCode });
  check("PIN salah ditolak 401", wrongPin.status === 401, "status " + wrongPin.status);

  // Bentuk benar tapi tidak ada di database.
  const notFound = await post("/api/merchant/lookup", { code: CODE, pin: PIN, orderCode: "MRZZZ-ZZZ" });
  check("kode tidak ada ditolak 404", notFound.status === 404, "status " + notFound.status);

  // Bentuk salah sama sekali (bukan 6 karakter) - ini harus 400, bukan 404.
  const malformed = await post("/api/merchant/lookup", { code: CODE, pin: PIN, orderCode: "BUKAN-KODE" });
  check("kode salah bentuk ditolak 400", malformed.status === 400, "status " + malformed.status);

  const lower = scanCode.toLowerCase().replace("-", "");
  const found = await post("/api/merchant/lookup", { code: CODE, pin: PIN, orderCode: lower });
  check("huruf kecil + tanpa hubung diterima", found.status === 200,
    JSON.stringify(found.data).slice(0, 200));

  if (found.status === 200) {
    console.log("  toko     : " + found.data.merchantName);
    console.log("  produk   : " + found.data.gameName + " " + found.data.packageLabel);
    console.log("  akun     : " + found.data.targetUserId + " (disamarkan)");
    console.log("  total    : Rp" + found.data.amount);
    check("bisa dijalankan", found.data.canRun === true);
    check("akun tujuan disamarkan", found.data.targetUserId.includes("*"),
      "tampak penuh: " + found.data.targetUserId);
  }

  // --- 6. Confirm ------------------------------------------------------------
  console.log("\n6. POST /api/merchant/confirm");
  const done = await post("/api/merchant/confirm", { code: CODE, pin: PIN, orderCode: scanCode });
  check("confirm berhasil", done.status === 200, JSON.stringify(done.data).slice(0, 250));

  const again = await post("/api/merchant/lookup", { code: CODE, pin: PIN, orderCode: scanCode });
  check("kode jadi tidak bisa dipakai lagi", again.status === 200 && again.data.canRun === false,
    "canRun = " + (again.data && again.data.canRun));

  const replay = await post("/api/merchant/confirm", { code: CODE, pin: PIN, orderCode: scanCode });
  check("scan kedua tidak menagih ulang", replay.status === 409,
    "status " + replay.status + " " + JSON.stringify(replay.data).slice(0, 120));

  // --- 7. Status akhir -------------------------------------------------------
  console.log("\n7. Status order setelah confirm");
  await new Promise((r) => setTimeout(r, 1500));
  const after = await supabaseGet(
    "orders?id=eq." + orderId + "&select=id,status,terminal_at,fulfilled_at,receivable_due_at",
  );
  const afterRow = after[0] || {};
  console.log("  status: " + afterRow.status);
  console.log("  receivable_due_at: " + JSON.stringify(afterRow.receivable_due_at));

  check("order tidak lagi pending_merchant", afterRow.status !== "pending_merchant",
    "masih " + afterRow.status);

  console.log("");
  console.log("=== RINGKASAN ===");
  console.log("lolos: " + passed + " | gagal: " + failed);
  console.log("");
  console.log("Order uji: " + orderId);
  console.log("(order ini disimpan di database untuk diperiksa manual)");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});