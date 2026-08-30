# Nambah

Nambah adalah web top up digital berbasis Next.js. Arsitektur MVP menggunakan Midtrans untuk payment gateway, Digiflazz sebagai supplier awal, dan Supabase PostgreSQL sebagai database.

## Status

`0.2.1` — Digiflazz TEST integration.

Saat credential Supabase/Digiflazz belum diisi, flow customer tetap dapat memakai static catalog/pricing fallback. Endpoint Digiflazz hanya tersedia melalui server dan seluruh endpoint admin dilindungi bearer token internal.

## Development

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Supabase

Gunakan project Supabase khusus Nambah.

Untuk instalasi baru:

1. Jalankan `supabase/schema.sql`.
2. Jalankan `supabase/seed.sql`.
3. Jalankan migration 0.2.1 di `supabase/migrations/20260831_001_digiflazz_test.sql`.

Untuk project yang sudah memakai schema 0.2.0, cukup jalankan migration 0.2.1 tersebut.

Server credential:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

## Digiflazz TEST setup

Tambahkan ke `.env.local`:

```env
NAMBAH_ADMIN_API_TOKEN=buat-token-random-panjang
DIGIFLAZZ_USERNAME=username-buyer
DIGIFLAZZ_API_KEY=api-key-buyer
DIGIFLAZZ_WEBHOOK_SECRET=secret-webhook
DIGIFLAZZ_CALLBACK_URL=https://domain-kamu.com/api/webhooks/digiflazz
```

Semua nilai di atas server-only. Jangan pernah menambahkan prefix `NEXT_PUBLIC_`.

### Endpoint internal

Semua endpoint admin membutuhkan header:

```text
Authorization: Bearer <NAMBAH_ADMIN_API_TOKEN>
```

Price list prepaid:

```text
GET /api/admin/digiflazz/price-list
GET /api/admin/digiflazz/price-list?brand=MOBILE%20LEGENDS&limit=50
GET /api/admin/digiflazz/price-list?code=SKU
```

Mapping SKU Digiflazz ke produk Nambah:

```text
POST /api/admin/digiflazz/map-sku
```

Body:

```json
{
  "productId": "ml-86",
  "supplierSku": "SKU_DARI_DIGIFLAZZ"
}
```

Mapping memverifikasi SKU ke Digiflazz lalu menyimpan `supplier_sku`, `supplier_cost`, status, dan `last_synced_at` ke `supplier_products`.

Test transaction:

```text
POST /api/admin/digiflazz/test-transaction
```

Body `outcome` yang tersedia:

- `success`
- `failed`
- `pending-success`
- `pending-failed`

Endpoint ini **selalu mengirim `testing: true`**, memakai SKU/test number resmi Digiflazz, dan tidak menyediakan jalur production transaction.

Webhook callback:

```text
POST /api/webhooks/digiflazz
```

Handler memverifikasi `X-Hub-Signature` dengan HMAC-SHA1 menggunakan `DIGIFLAZZ_WEBHOOK_SECRET`, lalu menyimpan event ke `supplier_webhook_events` untuk audit test callback.

## Security boundary

- Supplier cost, merchant fee, margin, balance, dan credential hanya diproses server-side.
- Public catalog tidak mengirim financial internals.
- Endpoint Digiflazz price list/mapping/test transaction membutuhkan admin bearer token.
- Test transaction 0.2.1 tidak memiliki opsi untuk menonaktifkan `testing: true`.
- Semua tabel database tetap RLS-enabled dan browser tidak mendapat direct table access.

## Roadmap berikutnya

- `0.2.2` supplier price sync + pricing production rules
- `0.2.3` supplier balance monitoring + Telegram alert
- `0.3.0` Midtrans Sandbox end-to-end
- Admin dashboard
- Affiliate dashboard
- Production hardening
