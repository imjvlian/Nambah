# Nambah Test Guide

Baseline target: **Nambah 1.0.0**

Tujuan guide ini adalah membuktikan flow Nambah secara end-to-end tanpa membelanjakan saldo supplier/customer sebelum launch production.

## 1. Automated test gate

Jalankan:

~~~bash
npm ci
npm run test
npm run build
~~~

Expected:

- seluruh Node regression test PASS;
- Next.js production build PASS;
- tidak ada TypeScript error;
- lockfile tidak berubah tak terduga.

CI GitHub menjalankan:

~~~text
npm ci
npm run test
npm run build
~~~

Push yang CI merah tidak boleh dipromosikan menjadi release candidate.

## 2. Admin readiness gate

Login sebagai admin dan buka:

~~~text
/admin
→ System
~~~

Untuk staging E2E:

~~~text
stagingBlockers = 0
readyForStagingE2E = true
~~~

Production blockers boleh tetap ada selama real-money memang belum diaktifkan.

Readiness juga memeriksa:

- Supabase credentials;
- Midtrans keys/environment;
- Digiflazz credential + callback;
- admin session secret;
- cron secret;
- database migration/table feature;
- supplier mapping coverage;
- fulfillment target coverage;
- live fulfillment double opt-in;
- receipt/monitoring config.

## 3. Safety assertion sebelum E2E

Pastikan staging:

~~~env
MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox
NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
~~~

Jangan lanjut jika salah satu live gate aktif.

## 4. Homepage & catalog smoke test

Test desktop dan mobile:

1. buka homepage;
2. catalog tampil;
3. category/filter dapat dipakai;
4. artwork product tidak broken;
5. buka minimal 3 game berbeda;
6. nominal package tampil;
7. payment method tampil;
8. tidak ada supplier cost/API credential di UI;
9. browser console tidak mempunyai fatal error;
10. refresh direct route product tetap bekerja.

PASS bila semua core navigation dapat digunakan tanpa blank screen/hydration fatal.

## 5. Product & pricing test

Untuk product representative:

1. pilih nominal;
2. masukkan target account;
3. pilih payment;
4. preview pricing;
5. test tanpa promo;
6. test promo;
7. test referral;
8. test Points bila login.

Server-created final price harus sama dengan preview valid terakhir.

Financial formula yang harus tetap aman:

~~~text
selling price
- promo discount
- referral discount
- points discount
+ customer payment fee
= final customer charge

net profit before affiliate
- affiliate commission
>= minimum Nambah profit
~~~

Test juga konfigurasi margin tidak aman. Checkout harus ditolak.

## 6. Account checker

Test:

- target kosong;
- format salah;
- format valid;
- user ID + server ID untuk game yang memerlukan server;
- game dengan provider checker;
- game tanpa provider checker.

Untuk game tanpa provider checker, UI/API tidak boleh mengklaim provider nickname verification jika hanya format lokal yang tervalidasi.

## 7. Auth

Test:

- signup;
- login;
- logout;
- expired access session + refresh;
- password salah;
- invalid session;
- repeated failed login;
- repeated signup abuse.

Expected:

- rate limiter bekerja;
- session disimpan HttpOnly;
- user A tidak dapat mengakses data user B.

## 8. Guest order access

1. checkout tanpa login;
2. simpan generated order URL/token;
3. buka order dari browser yang sama;
4. buka order tanpa token/cookie dari incognito;
5. pastikan akses ditolak;
6. buka dengan secure order link yang benar.

Order access menggunakan opaque credential per order, bukan global shared secret.

## 9. Midtrans Sandbox

Test:

### Success
Pembayaran settlement/capture accepted harus menjadi:

~~~text
pending_payment → paid
~~~

lalu fulfillment dijalankan.

### Pending
Payment pending tidak boleh dianggap success.

### Cancel / Expire
Order yang belum pernah verified paid dapat menjadi cancelled.

### Failure
Failure dapat menjadi failed jika order belum masuk verified-paid path.

### Refund
Refund/partial refund harus menjadi refunded.

### Delayed event
Event pending/deny/expire yang datang terlambat tidak boleh menurunkan state order yang sudah paid/processing/success.

### Gross amount mismatch
Notification/status dengan gross amount berbeda dari frozen order total harus ditolak.

### Signature
Invalid notification signature harus ditolak.

## 10. Staging Test Lab

Buka:

~~~text
/admin/test-lab
~~~

Gunakan satu scenario per test.

### Success

~~~text
scenario = success
scope = next-order
~~~

Expected:

~~~text
Midtrans Sandbox
→ verified paid
→ Digiflazz testing:true
→ success
→ receipt lifecycle
→ Points lifecycle
→ affiliate lifecycle
~~~

### Failed

Expected:

- verified payment tetap tercatat;
- supplier failure terlihat;
- sistem tidak mengubah sejarah pembayaran menjadi “belum bayar”.

### Pending → Success

Expected:

~~~text
initial supplier transaction = pending
→ reconciliation
→ persisted test scenario reused
→ same deterministic request_ref
→ success
~~~

### Pending → Failed

Sama, terminal akhirnya failed.

Setelah initial pending, ubah global Test Lab/ENV ke scenario lain lalu jalankan reconciliation. Order harus tetap memakai scenario yang sudah dibekukan di order.

## 11. Digiflazz idempotency & webhook

Verify:

- request ref = `NMB-<orderId>`;
- duplicate dispatch memakai ref sama;
- duplicate callback tidak menduplikasi fulfillment;
- valid signature diterima;
- invalid signature ditolak;
- SKU mismatch tidak diterapkan;
- terminal success/failed tidak dapat dibalik callback konflik;
- callback verified tersimpan untuk audit.

## 12. Reconciliation

Buka:

~~~text
/admin/operations
~~~

Buat/identifikasi staging order recoverable.

Run order reconciliation.

Expected:

- stuck paid order diproses;
- supplier pending dicek ulang;
- failed receipt di-retry sesuai idempotency;
- stale sending receipt ditandai untuk review;
- resolved incident hilang/closed pada health run berikutnya.

## 13. Operations Center

Verify detector untuk:

- paid/processing order > threshold;
- supplier pending > threshold;
- failed receipt;
- stale sending receipt;
- financial reconciliation error;
- supplier low balance;
- supplier critical balance.

Critical notification tidak boleh spam setiap run; incident mempunyai dedup/cooldown.

## 14. Nambah Points

Rules baseline:

~~~text
1 point = Rp10
earn: 1 point / Rp2.000 eligible spend
minimum redeem: 100
redeem step: 100
max redeem value: 20% subtotal
~~~

Test:

- guest tidak earn/redeem;
- login user earn setelah success;
- reserve sebelum final payment;
- duplicate status tidak double earn/redeem;
- insufficient points ditolak;
- redeem di atas max ditolak;
- failed/cancelled/refunded restore sesuai lifecycle;
- FIFO point lot digunakan.

### Points expiry

Gunakan fixture staging dengan lot expired.

Run:

~~~text
Admin → Nambah Points → Run expiry
~~~

atau:

~~~text
GET /api/cron/points-expiry
Authorization: Bearer <CRON_SECRET>
~~~

Verify:

- hanya remaining unreserved Points yang expire;
- reserved allocation tidak hilang di tengah checkout;
- ledger mendapat entry `expire`;
- rerun tidak double-expire.

## 15. Promotion

Test:

- code valid;
- inactive;
- expired;
- min order;
- max discount;
- product restriction;
- quota;
- quota per user;
- concurrent checkout.

Lifecycle:

~~~text
checkout → reserved
paid/processing/success → committed
failed/cancelled/refunded → released
~~~

Quota tidak boleh overbook pada concurrent request.

## 16. Affiliate commission

Lifecycle:

~~~text
pending_payment → no new commission requirement
paid/processing → pending
success → available
failed/refunded/cancelled → cancelled
~~~

Komisi yang sudah withdrawn tidak boleh dibatalkan oleh status sync berulang.

Default affiliate rate baseline adalah 20% dari eligible net profit, tetapi gunakan frozen order economics sebagai source of truth.

## 17. Affiliate withdrawal

Prerequisite:

- affiliate linked ke user melalui Admin → Affiliate Withdrawal Center;
- tersedia commission status available.

Customer:

1. buka Account;
2. affiliate panel muncul;
3. request nominal <= available;
4. saldo tersebut berpindah secara logis menjadi reserved;
5. request kedua aktif harus ditolak;
6. customer dapat cancel request pending.

Admin:

1. buka `/admin/affiliates`;
2. normal admin dapat melihat;
3. superadmin dapat approve;
4. payout dilakukan manual di luar Nambah;
5. superadmin mark paid dengan payment reference;
6. paid withdrawal menambah withdrawn total;
7. fully consumed commission menjadi withdrawn.

Reject test:

- pending/approved dapat rejected;
- alasan wajib;
- reserved balance kembali available.

Concurrency test:

- dua request paralel tidak boleh mengalokasikan commission yang sama melebihi sisa amount.

## 18. Receipt

Dengan Brevo staging:

- success mengirim satu receipt;
- duplicate callback tidak mengirim duplikat setelah successful send;
- provider email failure tidak rollback order success;
- admin retry tersedia;
- recipient sesuai checkout/profile.

## 19. Finance reconciliation

Run:

~~~text
Admin → Finance → Run reconciliation
~~~

Verify:

- frozen final price vs payment;
- frozen supplier cost vs supplier transaction;
- Points amounts;
- affiliate economics;
- order status relationships.

Financial reconciliation hanya mendeteksi mismatch. Jangan gunakan untuk auto-move money.

Expected sebelum launch:

~~~text
0 unexplained critical error
~~~

## 20. Supplier balance

Run admin/cron balance check.

Verify:

- current balance;
- reserved estimate;
- available balance;
- low threshold;
- critical threshold;
- Telegram alert jika configured.

## 21. Admin security

Verify:

- non-admin account → forbidden;
- account-bound admin session berisi signed user ID/role;
- session tampering → unauthorized;
- session expiry → login ulang;
- high-risk catalog/supplier mutation membutuhkan superadmin;
- withdrawal payout action membutuhkan superadmin;
- admin mutation membuat audit log actor + role;
- legacy bearer hanya recovery path.

## 22. Rate limiting

Test minimal:

~~~text
login: repeated invalid login
signup: repeated signup
game-account check: burst request
order-create: burst request
affiliate-withdrawal: > 5 request/hour
~~~

Expected: request dibatasi tanpa mengekspos raw IP sebagai durable key.

## 23. Cron authentication

Untuk setiap cron endpoint:

1. request tanpa Authorization → unauthorized;
2. token salah → unauthorized;
3. token benar → endpoint berjalan.

Daftar:

~~~text
/api/cron/reconcile
/api/cron/financial-reconcile
/api/cron/digiflazz-balance
/api/cron/points-expiry
/api/cron/operations-health
~~~

## 24. Production rehearsal tanpa live supplier

Sebelum mengaktifkan Digiflazz live:

1. staging E2E semua PASS;
2. CI green;
3. Admin System menunjukkan blocker yang tersisa;
4. mapping SKU aktif diperiksa;
5. target template diperiksa;
6. callback URL provider diperiksa;
7. Supabase Auth production URL diperiksa;
8. Brevo sender verified;
9. Telegram alerts test;
10. financial reconciliation bersih.

## 25. First real-money transaction

Langkah ini hanya setelah explicit owner approval.

Pilih product dengan nominal terkecil yang representatif.

Expected:

~~~text
production payment
→ signed webhook
→ paid
→ digiflazz-live
→ supplier SN
→ success
→ receipt
→ Points
→ commission
→ financial reconciliation
~~~

Setelah transaksi, verifikasi manual provider dashboard dan database/admin UI.

Jika ada discrepancy yang tidak dipahami:

~~~env
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
~~~

lalu hentikan traffic baru sampai root cause ditemukan.

## 26. Exit criteria 1.0.0

Code release dapat diberi versi 1.0.0 bila:

- CI PASS;
- test suite PASS;
- production build PASS;
- dokumentasi sinkron;
- semua safety gate tersedia;
- schema/migration source of truth lengkap;
- no known code blocker pada staging flow.

**Live launch** mempunyai gate tambahan:

- environment production benar;
- provider key production benar;
- semua product yang enabled-live punya mapping;
- semua product yang enabled-live punya verified target template;
- leaked-password protection Supabase aktif;
- cron/monitoring aktif;
- satu controlled real-money test berhasil.

Dengan demikian versi 1.0.0 tidak identik dengan otomatis membuka live-money.
