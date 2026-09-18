# Nambah Production Guide

Baseline target: **1.0.0**

Versi aplikasi dan aktivasi uang asli adalah dua hal terpisah. Release 1.0.0 tetap aman selama production payment/live supplier gate belum diaktifkan.

## 1. Sebelum deployment

Jalankan:

~~~bash
npm ci
npm run test
npm run build
~~~

CI GitHub harus green.

Baca juga:

~~~text
ENVIRONMENT_GUIDE.md
TEST_GUIDE.md
RELEASE_CHECKLIST.md
DEVELOPER_REFERENCE.md
~~~

## 2. Database

Database Nambah yang sudah berjalan harus mempunyai migration/features sampai:

~~~text
012 Nambah Points
013 Affiliate commissions
014 Promotion management
015 Customer profiles
016 Live fulfillment targets
017 Financial reconciliation
018 Production hardening
019 Staging Test Lab
020 Points lots + expiry
021 Points reverse/reservation consistency
022 Operational incidents
023 Admin principal audit
024 Affiliate withdrawal workflow
~~~

Jangan menjalankan seed development ke database yang sudah berisi data production.

Setelah perubahan schema:

- review Supabase Security Advisor;
- review Performance Advisor;
- verifikasi function grants;
- verifikasi RLS/table grants.

## 3. Staging deployment

Gunakan configuration staging dari `ENVIRONMENT_GUIDE.md`.

Safety minimum:

~~~env
MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox
NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
~~~

Buka:

~~~text
/admin → System
~~~

Staging E2E hanya dimulai jika:

~~~text
readyForStagingE2E = true
stagingBlockers = 0
~~~

## 4. Vercel Cron

Repo menyediakan `vercel.json`:

~~~text
reconcile             every 5 minutes
operations-health     every 10 minutes
digiflazz-balance     every 15 minutes
financial-reconcile   hourly
points-expiry         daily
~~~

Vercel cron schedule memakai UTC.

Set:

~~~env
CRON_SECRET=<long random secret>
~~~

Route Nambah memverifikasi:

~~~http
Authorization: Bearer <CRON_SECRET>
~~~

Jika deploy di platform selain Vercel, jadwalkan endpoint yang sama dengan scheduler platform tersebut.

## 5. Provider callback

Midtrans:

~~~text
https://<production-domain>/api/webhooks/midtrans
~~~

Digiflazz:

~~~text
https://<production-domain>/api/webhooks/digiflazz
~~~

Signature verification tidak boleh dinonaktifkan.

## 6. Midtrans Production

Set:

~~~env
MIDTRANS_ENVIRONMENT=production
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=production
MIDTRANS_SERVER_KEY=<production>
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=<production>
~~~

Backend dan browser environment harus sama.

## 7. Catalog live gate

Sebelum Digiflazz live:

- tidak ada active product tanpa supplier mapping;
- tidak ada enabled-live product tanpa verified target template;
- SKU benar;
- target format benar;
- harga supplier/current cost diperiksa.

Admin → System menampilkan catalog coverage blocker.

Jangan mengisi target template secara otomatis/tebakan.

## 8. Digiflazz live gate

Hanya setelah explicit owner approval:

~~~env
NAMBAH_FLOW_TEST_MODE=false
NAMBAH_FULFILLMENT_MODE=digiflazz-live
NAMBAH_ALLOW_LIVE_FULFILLMENT=true
NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE
~~~

Kill switch:

~~~env
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
~~~

## 9. Receipt

Production:

~~~env
BREVO_RECEIPT_ENABLED=true
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Nambah
~~~

Sender/domain harus verified sebelum diaktifkan.

## 10. Operations

Direkomendasikan:

~~~env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
~~~

Monitoring:

~~~text
/admin/operations
/admin → Finance
/admin → System
~~~

Production launch tidak boleh diteruskan bila ada unexplained critical finance mismatch/operations incident.

## 11. Supabase Auth

Sebelum normal production traffic:

- production Site URL benar;
- Redirect URLs benar;
- Leaked Password Protection aktif;
- secret/service-role tidak ada di client;
- admin account/role diverifikasi.

## 12. Controlled first live transaction

Setelah semua checklist lulus:

1. aktifkan production payment;
2. aktifkan live supplier gate;
3. pilih nominal terkecil yang representatif;
4. jalankan satu transaksi;
5. cocokkan Midtrans;
6. cocokkan Digiflazz;
7. verifikasi SN;
8. verifikasi order success;
9. verifikasi receipt;
10. verifikasi Points;
11. verifikasi affiliate;
12. run financial reconciliation.

Jangan membuka traffic normal sebelum transaksi ini dapat dijelaskan end-to-end.

## 13. Rollback

Jika terdapat discrepancy:

1. set `NAMBAH_ALLOW_LIVE_FULFILLMENT=false`;
2. jangan menghapus verified payment;
3. cek Operations Center;
4. cek order detail;
5. run reconciliation hanya melalui jalur idempotent;
6. rollback deployment bila regression berasal dari code;
7. dokumentasikan incident;
8. uji fix di staging sebelum membuka traffic lagi.

## 14. Known launch blockers yang memang harus diisi operator

Code dapat mencapai 1.0.0 walau item operasional berikut belum diisi:

- Production provider keys;
- production domain/callback configuration;
- verified fulfillment target template per product/game;
- optional provider/account checker routes;
- Supabase leaked-password protection toggle;
- explicit live-money owner approval.

Item tersebut bukan aman untuk ditebak atau diaktifkan otomatis oleh source code.
