# Nambah Environment Guide

Baseline target: **Nambah 1.0.0**

Dokumen ini menjelaskan environment variable Nambah untuk local, staging, dan production. Jangan commit credential asli ke Git.

## 1. Tiga mode operasional

| Mode | Midtrans | Fulfillment | Uang asli |
|---|---|---|---|
| Local development | Sandbox | simulate / digiflazz-test | OFF |
| Staging | Sandbox | digiflazz-test | OFF |
| Production | Production | digiflazz-live | ON hanya setelah launch gate |

Nomor versi aplikasi tidak pernah mengaktifkan uang asli secara otomatis.

## 2. Supabase

Wajib:

~~~env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
~~~

Aturan:

- `SUPABASE_SECRET_KEY` hanya untuk server.
- Jangan pernah membuat versi `NEXT_PUBLIC_` dari secret/service-role key.
- Browser hanya boleh menerima publishable key.
- Semua akses data sensitif Nambah tetap melalui API server.
- Production harus menggunakan project Supabase khusus Nambah yang benar.

## 3. Secret aplikasi

Wajib untuk deployed environment:

~~~env
NAMBAH_ADMIN_SESSION_SECRET=
NAMBAH_RATE_LIMIT_SECRET=
CRON_SECRET=
~~~

Gunakan random secret panjang dan berbeda untuk setiap variable.

- `NAMBAH_ADMIN_SESSION_SECRET`: signing cookie admin.
- `NAMBAH_RATE_LIMIT_SECRET`: salt pseudonymous rate-limit key.
- `CRON_SECRET`: bearer auth endpoint cron.

Legacy/emergency only:

~~~env
NAMBAH_ADMIN_API_TOKEN=
~~~

Browser admin normal memakai akun Nambah yang tercatat di `admin_users`, bukan bearer token.

## 4. Local development

Aman untuk development:

~~~env
MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox

NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=simulate
NAMBAH_SIMULATED_FULFILLMENT_OUTCOME=success

NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
~~~

Alternatif bila ingin menguji API Digiflazz tanpa saldo real:

~~~env
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_DIGIFLAZZ_TEST_OUTCOME=success
~~~

## 5. Staging

Gunakan:

~~~env
MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox
MIDTRANS_SERVER_KEY=<Sandbox Server Key>
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=<Sandbox Client Key>

NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_DIGIFLAZZ_TEST_OUTCOME=success

NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
~~~

Digiflazz:

~~~env
DIGIFLAZZ_USERNAME=
DIGIFLAZZ_API_KEY=
DIGIFLAZZ_WEBHOOK_SECRET=
DIGIFLAZZ_CALLBACK_URL=https://<staging-domain>/api/webhooks/digiflazz
~~~

Pada `digiflazz-test`, request provider memakai `testing:true`.

Admin dapat mengganti scenario melalui:

~~~text
/admin/test-lab
~~~

Scenario:

~~~text
success
failed
pending-success
pending-failed
~~~

Perubahan Test Lab tidak dapat mengaktifkan `digiflazz-live`.

## 6. Midtrans production

Hanya setelah staging E2E lulus:

~~~env
MIDTRANS_ENVIRONMENT=production
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=production
MIDTRANS_SERVER_KEY=<Production Server Key>
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=<Production Client Key>
~~~

Server dan browser harus memakai environment yang sama.

Jangan mencampur:

~~~text
production ENV + Sandbox key
sandbox ENV + Production key
~~~

Admin → System akan memblokir production readiness jika environment tidak sesuai.

## 7. Digiflazz production

Credential:

~~~env
DIGIFLAZZ_USERNAME=
DIGIFLAZZ_API_KEY=
DIGIFLAZZ_WEBHOOK_SECRET=
DIGIFLAZZ_CALLBACK_URL=https://<production-domain>/api/webhooks/digiflazz
~~~

Sebelum live:

1. setiap produk aktif harus mempunyai supplier mapping aktif;
2. setiap produk aktif harus resolve `fulfillment_target_template` dari product atau game;
3. target template sudah diuji dengan akun valid;
4. saldo supplier dan monitoring sudah siap;
5. reconciliation staging sudah lulus;
6. owner menyetujui real-money test.

Live-money gate:

~~~env
NAMBAH_FLOW_TEST_MODE=false
NAMBAH_FULFILLMENT_MODE=digiflazz-live
NAMBAH_ALLOW_LIVE_FULFILLMENT=true
NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE
~~~

Value acknowledgement harus **persis** seperti di atas.

Jika terjadi incident:

~~~env
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
~~~

adalah kill-switch tercepat untuk mencegah dispatch supplier baru.

## 8. Fulfillment target

Template yang didukung:

~~~text
{user_id}
{user_id}{server_id}
{user_id}|{server_id}
~~~

Product-level template meng-override game-level template.

Jangan menebak format target. Format harus diverifikasi terhadap requirement SKU/provider.

## 9. Brevo receipt

~~~env
BREVO_RECEIPT_ENABLED=false
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Nambah
~~~

Aktifkan hanya setelah sender/domain sudah verified.

Production:

~~~env
BREVO_RECEIPT_ENABLED=true
~~~

Receipt hanya dikirim setelah order `success` dan delivery bersifat idempotent.

## 10. Telegram operations alert

Direkomendasikan untuk production:

~~~env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
~~~

Dipakai untuk alert supplier balance dan critical operations incident.

Operations Center:

~~~text
/admin/operations
~~~

## 11. Account checker

Primary:

~~~env
VOLSEVER_API_KEY=
VOLSEVER_GAME_ROUTES_JSON=
~~~

Fallback yang masih didukung:

~~~env
GEMPAY_API_USERNAME=
GEMPAY_API_SECRET=
~~~

Semua credential server-only.

Jika game tidak mempunyai provider checker, Nambah hanya boleh mengklaim validasi format lokal, bukan nickname verification provider.

## 12. Cron endpoints

Semua endpoint memakai:

~~~http
Authorization: Bearer <CRON_SECRET>
~~~

Daftar:

~~~text
GET /api/cron/reconcile
GET /api/cron/financial-reconcile
GET /api/cron/digiflazz-balance
GET /api/cron/points-expiry
GET /api/cron/operations-health
~~~

Saran fungsi:

- reconciliation: recovery pending order/provider/receipt;
- financial reconciliation: mendeteksi mismatch, tidak memindahkan uang;
- Digiflazz balance: snapshot dan alert saldo;
- Points expiry: menjalankan FIFO expiry lot;
- operations health: incident detector + deduplicated alert.

## 13. Supabase dashboard sebelum production

Periksa manual:

1. Auth Site URL = domain production.
2. Redirect URLs hanya domain yang diperlukan.
3. Enable **Leaked Password Protection**.
4. Publishable key dan server secret berasal dari project yang sama.
5. Security Advisor direview.
6. Performance Advisor direview.
7. Tidak ada service-role/secret key di browser bundle.

Catatan: Advisor `RLS enabled but no policy` pada tabel internal Nambah adalah desain server-proxy saat role `anon/authenticated` memang tidak diberi akses tabel tersebut. Jangan menambah policy permissive hanya untuk menghilangkan INFO lint.

## 14. Webhook URL

Midtrans:

~~~text
https://<domain>/api/webhooks/midtrans
~~~

Digiflazz:

~~~text
https://<domain>/api/webhooks/digiflazz
~~~

Signature verification wajib tetap aktif.

## 15. Affiliate withdrawal

Tidak memerlukan ENV baru.

Flow:

~~~text
customer request
→ commission allocation reserved
→ admin approve
→ operator transfer manual
→ superadmin mark paid + transfer reference
~~~

Nambah tidak otomatis menarik/mengirim dana bank.

## 16. Variable lama yang jangan dihidupkan kembali

Tidak diperlukan oleh architecture sekarang:

~~~env
NAMBAH_ORDER_ACCESS_TOKEN_SECRET=
EVO_GAME_CHECK_API_KEY=
DIGIFLAZZ_USERNAME_CHECK_ENABLED=
~~~

Order guest sekarang memakai random opaque token per order dan hanya hash-nya yang disimpan.

## 17. Secret rotation

Sebelum launch, rotate secret yang pernah:

- ditempel di chat;
- masuk screenshot;
- muncul di log;
- masuk source code/commit;
- dibagikan ke pihak yang tidak lagi membutuhkan akses.

Setelah rotation, redeploy dan lakukan staging smoke test ulang.
