# Nambah 0.5.0 — Production Candidate

Versi 0.5.0 berarti codebase sudah memiliki jalur production, tetapi **bukan berarti live-money otomatis aktif**. Default tetap aman: Midtrans sandbox bila environment tidak diisi dan Digiflazz live membutuhkan dua explicit opt-in.

## 1. Database

Untuk database Nambah yang sudah berjalan, jalankan migration baru secara berurutan dan jangan menjalankan ulang seed:

1. `20260918_012_nambah_points.sql`
2. `20260918_013_affiliate_commissions.sql`
3. `20260918_014_promotion_management.sql`
4. `20260918_015_customer_profiles.sql`
5. `20260918_016_live_fulfillment_targets.sql`
6. `20260918_017_financial_reconciliation.sql`
7. `20260918_018_production_hardening.sql`

Untuk instalasi baru, jalankan `supabase/schema.sql` lalu seluruh migration sesuai urutan yang belum tercakup deployment database.

## 2. Staging di Vercel

Gunakan:

```env
MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox

NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
```

Set callback:

```text
Midtrans  : https://nambah.vercel.app/api/webhooks/midtrans
Digiflazz : https://nambah.vercel.app/api/webhooks/digiflazz
```

Lalu buka Admin → System. Semua **staging** check harus pass sebelum E2E.

## 3. Production payment

Production Midtrans membutuhkan Production Server Key + Client Key dan:

```env
MIDTRANS_ENVIRONMENT=production
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=production
```

Backend akan memakai endpoint production Midtrans dan browser akan memuat Snap production. Jangan mencampur key sandbox dengan environment production.

## 4. Production fulfillment

Setiap game/product yang akan dijual live harus memiliki template target yang eksplisit:

```text
{user_id}
{user_id}{server_id}
{user_id}|{server_id}
```

Hanya placeholder `{user_id}` dan `{server_id}` yang diizinkan. Product template meng-override game template.

Live Digiflazz baru dapat berjalan jika:

```env
NAMBAH_FLOW_TEST_MODE=false
NAMBAH_FULFILLMENT_MODE=digiflazz-live
NAMBAH_ALLOW_LIVE_FULFILLMENT=true
NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE
```

Selain itu SKU harus mapped/active dan harga supplier aktual tidak boleh melebihi frozen supplier cost pada order.

## 5. Security / operations

Wajib untuk production:

```env
NAMBAH_ADMIN_SESSION_SECRET=
NAMBAH_RATE_LIMIT_SECRET=
CRON_SECRET=
```

Direkomendasikan:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
```

Endpoint operasional:

```text
GET /api/health
GET /api/admin/readiness
GET /api/cron/reconcile
GET /api/cron/financial-reconcile
GET /api/cron/digiflazz-balance
```

Cron endpoints membutuhkan `Authorization: Bearer <CRON_SECRET>`.

## 6. Manual launch checklist

Sebelum membuka traffic live:

- Midtrans Payment Notification URL sudah mengarah ke webhook Nambah.
- Digiflazz callback URL dan webhook secret sudah benar.
- Supabase Auth Site URL + Redirect URL sudah menggunakan domain production.
- Brevo sender/domain sudah authenticated.
- Semua SKU live diperiksa satu per satu.
- Semua fulfillment target template diuji dengan akun valid.
- Jalankan financial reconciliation dan pastikan tidak ada mismatch kritis.
- Jalankan satu transaksi real bernilai kecil setelah approval owner.
- Pastikan receipt, points, promo, affiliate commission, supplier SN, dan order status semuanya konsisten.
- Baru setelah itu buka traffic production.

## Safety

Mengubah package ke 0.5.0 **tidak** mengaktifkan live money. Aktivasi real payment/supplier tetap keputusan operasional terpisah melalui environment variables dan dashboard provider.
