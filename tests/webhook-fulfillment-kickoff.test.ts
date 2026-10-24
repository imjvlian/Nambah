import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * P3.4 (24 Okt 2026): webhook tidak lagi menunggu dispatch ke supplier.
 *
 * "Job queue" di sini TIDAK berarti tabel jobs baru — orders.status
 * sudah menjadi antrean persistennya (paid/processing = menunggu
 * dispatch), timer reconcile (5 menit) sudah menjadi worker-nya, dan
 * requestRef per order sudah membuat fulfillment idempoten. Yang
 * hilang hanyalah: jalur webhook membalik pelan karena menunggu
 * panggilan supplier selesai (bisa 15-30 detik) — gateway mengulang
 * kirimannya, dan restart di tengah jalan menunda order sampai
 * putaran reconcile berikutnya.
 *
 * Yang dijaga test ini: semua jalur status pembayaran memakai kickoff
 * non-blocking, semua efek samping tetap hidup di dalam fulfillment,
 * dan jaring pengaman reconcile tetap utuh.
 */

test("kickoffFulfillment: non-blocking, tangkap galatnya sendiri", () => {
  const fulfillment = readFileSync("src/lib/fulfillment.ts", "utf8");

  assert.ok(
    fulfillment.includes("export function kickoffFulfillment(orderId: string): void"),
    "helper kickoff harus ada dan tidak mengembalikan promise",
  );

  const fnMatch = fulfillment.match(
    /export function kickoffFulfillment[\s\S]*?\n\}/,
  );
  assert.ok(fnMatch, "badan kickoffFulfillment harus terbaca");
  assert.ok(
    fnMatch[0].includes("void fulfillPaidOrder(orderId).catch("),
    "dijalankan tanpa await dan galatnya ditangkap — bukan unhandled rejection",
  );
  assert.ok(
    fnMatch[0].includes("Fulfillment kickoff failed"),
    "kegagalan kickoff tercatat di log server",
  );
});

test("efek samping tetap di dalam fulfillment — tidak ada yang hilang", () => {
  const fulfillment = readFileSync("src/lib/fulfillment.ts", "utf8");

  // Receipt + alert hidup DI DALAM fulfillPaidOrder, makanya tidak
  // di-await-nya pemanggil tidak memotong apa pun.
  assert.ok(
    fulfillment.includes("await deliverSuccessReceipt(orderId);"),
    "receipt sukses tetap dikirim dari dalam fulfillment",
  );
  assert.ok(
    fulfillment.includes("notifyFulfillmentFailed(orderId)"),
    "alert gagal tetap terkirim dari dalam fulfillment",
  );
  assert.ok(
    fulfillment.includes("notifyFulfillmentSucceeded("),
    "alert sukses/SN tetap terkirim dari dalam fulfillment",
  );
});

test("ketiga jalur status pembayaran memakai kickoff, bukan await", () => {
  const orderService = readFileSync("src/lib/order-service.ts", "utf8");

  const kickoffUses = orderService.split("kickoffFulfillment(orderId);").length - 1;
  assert.equal(
    kickoffUses,
    3,
    "Midtrans, DOKU, dan Paylabs — ketiganya kickoff",
  );
  assert.ok(
    !orderService.includes("await fulfillPaidOrder(orderId);"),
    "tidak ada lagi fulfillment yang di-await di jalur status — webhook harus membalik cepat",
  );
  assert.ok(
    !orderService.includes("fulfillment trigger failed"),
    "blok try/catch lama untuk await sudah tidak ada",
  );
});

test("jaring pengaman reconcile tetap utuh: worker untuk order yang kickoff-nya mati", () => {
  const reconciliation = readFileSync("src/lib/reconciliation.ts", "utf8");
  const timers = readFileSync("deploy/systemd/install-timers.sh", "utf8");

  assert.ok(
    reconciliation.includes("const recovery = await fulfillPaidOrder(order.id);"),
    "reconcile tetap mem-fulfill ulang order yang stuck",
  );
  assert.ok(
    reconciliation.includes("MIN_ORDER_AGE_MS = 60_000"),
    "order baru diberi umur 60 detik sebelum dianggap stuck — kickoff segar tidak berebutan dengan reconcile",
  );
  assert.ok(
    reconciliation.includes('status: "in.(paid,processing)"'),
    "status orders memang berfungsi sebagai antrean persisten",
  );
  assert.ok(
    timers.includes("reconcile|*-*-* *:0/5:00 UTC|*/5 * * * *"),
    "timer reconcile berjalan tiap 5 menit — jaminan pemulihan terburut ~6 menit",
  );
});

test("webhook Midtrans kini membalik segera: hanya verifikasi + pencatatan + kickoff", () => {
  const webhook = readFileSync("src/app/api/webhooks/midtrans/route.ts", "utf8");
  const orderService = readFileSync("src/lib/order-service.ts", "utf8");

  // Jalur webhook: verifikasi signature -> applyMidtransStatus (pencatatan
  // + kickoff) -> respons. Tidak ada panggilan supplier yang di-await.
  assert.ok(
    webhook.includes("verifyMidtransNotificationSignature(payload)"),
    "signature tetap diverifikasi sebelum apa pun",
  );
  assert.ok(
    webhook.includes("applyMidtransStatus(payload, \"webhook\", true)"),
    "pencatatan status tetap sinkron — hanya dispatch yang latar",
  );

  // Pemisahan yang ditegakkan: apply* hanya menyentuh fulfillPaidOrder
  // lewat kickoff. Kalau seseorang menambah await lagi, indexOf ini
  // menangkapnya.
  const applyMatch = orderService.match(
    /export async function applyMidtransStatus\([\s\S]*?\n\}/,
  );
  assert.ok(applyMatch, "fungsi applyMidtransStatus harus terbaca");
  assert.ok(
    applyMatch[0].includes("kickoffFulfillment(orderId);"),
    "applyMidtransStatus kickoff, bukan await",
  );
  assert.ok(
    !applyMatch[0].includes("await fulfillPaidOrder"),
    "applyMidtransStatus tidak menunggu dispatch",
  );
});

test("jalur merchant tetap pola yang sama — preseden yang sudah terbukti", () => {
  const merchant = readFileSync("src/app/api/merchant/confirm/route.ts", "utf8");

  assert.ok(
    merchant.includes("void fulfillPaidOrder(orderId)"),
    "jalur merchant sudah non-blocking sejak awal — kickoff hanya meratakan pola itu",
  );
});
