# Nambah Production Guide

Baseline target: **1.0.0**

Versi aplikasi dan aktivasi uang asli adalah dua hal terpisah. Baseline resmi saat ini adalah **1.0.0**; commit history yang menyebut `1.0.12` dianggap label incremental tetapi `package.json`, `CHANGELOG.md`, dan dokumentasi tetap memakai `1.0.0` sampai ada release bump eksplisit. Release 1.0.0 tetap aman selama production payment/live supplier gate belum diaktifkan.

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
019 Account check cache
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

## 4. Cron (systemd timer di VPS)

Production berjalan di VPS, bukan Vercel. `vercel.json` sudah dihapus karena
file itu mendaftarkan cron yang tidak akan pernah dieksekusi di sini — dan
jadwal yang tertulis di sana (`0 3 * * *` demi batas plan Hobby Vercel) bukan
jadwal yang dipakai.

Penjadwalan ada di `deploy/systemd/`:

~~~text
reconcile             setiap 5 menit
operations-health     setiap 10 menit
digiflazz-balance     setiap 15 menit
financial-reconcile   setiap jam (menit 7)
points-expiry         00:30 UTC setiap hari
telegram-dispatch     setiap menit
daily-digest          01:00 UTC = 08:00 WIB
~~~

Semua jadwal ditulis eksplisit dalam UTC, jadi tidak berubah kalau timezone
server diganti.

Set:

~~~env
CRON_SECRET=<long random secret>
~~~

Route Nambah memverifikasi:

~~~http
Authorization: Bearer <CRON_SECRET>
~~~

Pemasangan dan tes manual ada di `deploy/systemd/README.md`. Ringkasnya:

~~~bash
sudo mkdir -p /etc/nambah
sudoedit /etc/nambah/cron.env      # CRON_SECRET + CRON_BASE_URL
sudo /opt/nambah/deploy/systemd/install-timers.sh
systemctl list-timers 'nambah-cron@*'
~~~

`Persistent=true` pada timer membuat job yang terlewat saat server mati tetap
jalan saat boot.

> **Penting — cron hanya jalan kalau timernya terpasang.** Jika timer belum
> di-install, `/api/cron/*` hanya merespons ketika dipanggil manual. Sebelum
> menganggap sweep dan rekonsiliasi berjalan, cek `systemctl list-timers` dulu.

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

Cron endpoints membutuhkan `Authorization: Bearer <CRON_SECRET>`. Di VPS header
itu dikirim oleh `deploy/systemd/nambah-cron-run.sh`, bukan otomatis.

### Jadwal cron

Jadwal ada di `deploy/systemd/install-timers.sh` (lihat §4):

| Path | Jadwal | Tugas |
| --- | --- | --- |
| `/api/cron/reconcile` | `*/5 * * * *` | Sweep order kedaluwarsa, retry supplier & receipt, purge cache cek akun |
| `/api/cron/operations-health` | `*/10 * * * *` | Deteksi incident + alert order nyangkut |
| `/api/cron/digiflazz-balance` | `*/15 * * * *` | Pemantauan saldo Digiflazz |
| `/api/cron/financial-reconcile` | `7 * * * *` | Rekonsiliasi keuangan (liabilitas points, promo, komisi) |
| `/api/cron/points-expiry` | `30 0 * * *` | Expiry poin |
| `/api/cron/telegram-dispatch` | `* * * * *` | Drain antrean notifikasi Telegram |
| `/api/cron/daily-digest` | `1 0 * * *` | Digest harian 08:00 WIB |

Untuk memastikan cron benar-benar berjalan (bukan hanya terdaftar):

~~~bash
systemctl list-timers 'nambah-cron@*'
journalctl -u nambah-cron@reconcile -n 20 --no-pager
~~~

atau panggil satu job secara langsung:

~~~bash
sudo -u nambah /opt/nambah/deploy/systemd/nambah-cron-run.sh reconcile
~~~

Respons `expiry.checked > 0` berarti sweeper menemukan order kedaluwarsa;
`expiry.cancelled` adalah jumlah order yang benar-benar dibatalkan dan
reservasinya dilepas.

## 11. Supabase Auth

Sebelum normal production traffic:

- production Site URL benar;
- Redirect URLs benar;
- Leaked Password Protection aktif;
- secret/service-role tidak ada di client;
- admin account/role diverifikasi.

Checklist go-live:

- Midtrans Payment Notification URL sudah mengarah ke webhook Nambah.
- Digiflazz callback URL dan webhook secret sudah benar.
- Supabase Auth Site URL + Redirect URL sudah menggunakan domain production.
- Brevo sender/domain sudah authenticated.
- Semua SKU live diperiksa satu per satu.
- Semua fulfillment target template diuji dengan akun valid.
- Jalankan financial reconciliation dan pastikan tidak ada mismatch kritis.
- Pastikan `CRON_SECRET` terisi di env Vercel **dan** cron benar-benar aktif
  (lihat tabel jadwal di atas). Tanpa ini, order kedaluwarsa tidak pernah
  dibatalkan dan reservasi points customer tidak pernah dikembalikan.
- Jalankan satu transaksi real bernilai kecil setelah approval owner.
- Pastikan receipt, points, promo, affiliate commission, supplier SN, dan order status semuanya konsisten.
- Baru setelah itu buka traffic production.

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

## 15. Telegram

Env (server-only):

~~~env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=   # hanya untuk bot dua arah
~~~

URL publik aplikasi diambil dari `NEXT_PUBLIC_SITE_URL` yang sudah ada, atau
diberi langsung dengan `--url`.

### Pesan keluar (selalu aktif)

，Semua ini berjalan tanpa webhook:

- saldo Digiflazz saat status berubah;
- incident operasional kritis (dari `/api/cron/operations-health`);
- order nyangkut di `paid`/`processing` lebih dari 5 menit;
- fulfilment gagal dan receipt gagal terkirim;
- digest harian 08:00 WIB.

Semua pengiriman dicatat di `telegram_delivery_log`. Alert yang bisa beruntun
(fulfillment, receipt) masuk antrean dulu dan dikirim oleh
`/api/cron/telegram-dispatch` satu per satu dengan jeda 1,1 detik — itu batas
Telegram per chat. Kalau antrean menumpuk, tekan "Kirim antrean Telegram" di
System & production readiness.

### Bot dua arah

~~~bash
node scripts/telegram-set-webhook.mjs --info
node scripts/telegram-set-webhook.mjs
node scripts/telegram-set-webhook.mjs --delete
~~~

Endpoint `/api/telegram/webhook` menolak request yang secret token-nya salah,
chat-nya bukan `TELEGRAM_ADMIN_CHAT_ID`, atau `update_id`-nya sudah pernah
diproses. Perintah yang tersedia: `/status`, `/saldo`, `/order NBH-...`,
`/incident`, `/retry-receipt NBH-...`, `/help`.

`/retry-receipt` adalah satu-satunya perintah yang menulis; ia memakai
`deliverSuccessReceipt` yang sama dengan scheduler, jadi tidak ada jalur kedua
yang bisa mengirim receipt ganda.

### Migration

`supabase/migrations/20261008_029_telegram_delivery_log.sql` wajib dijalankan
sebelum bot digunakan. Tanpa tabelnya, pesan keluar tetap terkirim (kegagalan
logging hanya masuk ke log server), tapi webhook dan dedupe tidak bekerja.
