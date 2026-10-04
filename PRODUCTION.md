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
8. `20260918_019_account_check_cache.sql`

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

Cron endpoints membutuhkan `Authorization: Bearer <CRON_SECRET>`. Vercel mengirim
header itu otomatis selama env `CRON_SECRET` terisi di project.

### Jadwal cron

Jadwal ada di `vercel.json` (sebelum file itu dibuat, tidak ada scheduler sama
sekali — seluruh reconciler hanya jalan kalau admin klik manual dari panel
admin):

| Path | Jadwal | Tugas |
| --- | --- | --- |
| `/api/cron/reconcile` | `0 3 * * *` (Hobby: harian) | Sweep order kedaluwarsa, retry supplier & receipt, purge cache cek akun |
| `/api/cron/financial-reconcile` | `17 * * * *` | Rekonsiliasi keuangan (liabilitas points, promo, komisi) |
| `/api/cron/digiflazz-balance` | `43 * * * *` | Pemantauan saldo Digiflazz |

> **Penting — batas plan Vercel.** Plan **Hobby hanya mengizinkan cron satu
> kali per hari**, dan deployment akan **ditolak** (`cron duration must be at
> least daily`) kalau ada jadwal < 1 hari. Karena itu `reconcile` diturunkan
> ke `0 3 * * *` (harian).
>
> `financial-reconcile` (17 * * * *) dan `digiflazz-balance` (43 * * * *) adalah
> jadwal per jam. Beberapa project Hobby **hanya mengizinkan total 1 cron job**.
> Kalau deployment gagal dengan pesan "maximum number of cron jobs" atau serupa,
> konsolidasi semua cron ke satu waktu harian saja (mis. `0 3 * * *`) sebelum
> deploy ulang.
>
> Dampak jadwal harian: reservasi points/promo dari order yang terlantar masih
> dilepas oleh sweeper, tapi bisa terlambat sampai ~24 jam (`expires_at` +
> grace 5 menit). Ini jauh lebih baik daripada membocorkannya permanen seperti
> sebelum Phase 0, tapi tidak secepat jeda 10 menit.

Untuk memastikan cron benar-benar berjalan (bukan hanya terdaftar), cek
`GET /api/cron/reconcile` secara manual dengan `CRON_SECRET` lalu lihat field
`expiry` pada respons. `expiry.checked > 0` berarti sweeper menemukan order
kedaluwarsa; `expiry.cancelled` adalah jumlah order yang benar-benar dibatalkan
dan reservasinya dilepas.

## 6. Manual launch checklist

Sebelum membuka traffic live:

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

## Safety

Mengubah package ke 0.5.0 **tidak** mengaktifkan live money. Aktivasi real payment/supplier tetap keputusan operasional terpisah melalui environment variables dan dashboard provider.
