# Nambah

Nambah adalah web top up digital berbasis Next.js. Arsitektur MVP menggunakan Midtrans untuk payment gateway, Digiflazz sebagai supplier awal, dan Supabase PostgreSQL sebagai database.

## Status

`0.2.2` — supplier price sync + pricing safety.

Katalog/pricing customer dapat memakai static fallback ketika Supabase belum dikonfigurasi. Saat Supabase aktif, supplier cost hanya dianggap valid setelah produk memiliki mapping SKU Digiflazz dan status supplier aktif.

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
3. Jalankan `supabase/migrations/20260831_001_digiflazz_test.sql`.
4. Jalankan `supabase/migrations/20260831_002_supplier_price_sync.sql`.

Untuk project yang sudah berada di 0.2.1, cukup jalankan migration `20260831_002_supplier_price_sync.sql`.

Server credential:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

`seed.sql` adalah bootstrap data. Setelah SKU supplier sudah dimapping dan harga live mulai disinkron, jangan gunakan seed untuk memperbarui supplier cost.

## Digiflazz

Tambahkan ke `.env.local`:

```env
NAMBAH_ADMIN_API_TOKEN=buat-token-random-panjang
DIGIFLAZZ_USERNAME=username-buyer
DIGIFLAZZ_API_KEY=api-key-buyer
DIGIFLAZZ_WEBHOOK_SECRET=secret-webhook
DIGIFLAZZ_CALLBACK_URL=https://domain-kamu.com/api/webhooks/digiflazz
```

Semua nilai di atas server-only. Jangan pernah menambahkan prefix `NEXT_PUBLIC_`.

### Direct test case

Untuk verifikasi API Development Digiflazz langsung dari PowerShell:

```powershell
.\scripts\test-digiflazz.ps1 -Outcome failed
```

Outcome yang tersedia:

- `success`
- `failed`
- `pending-success`
- `pending-failed`

Script mengirim request langsung ke Digiflazz dengan `testing: true` dan tidak mencetak API key.

### Endpoint internal

Semua endpoint admin membutuhkan:

```text
Authorization: Bearer <NAMBAH_ADMIN_API_TOKEN>
```

Price list:

```text
GET /api/admin/digiflazz/price-list
GET /api/admin/digiflazz/price-list?brand=MOBILE%20LEGENDS&limit=50
GET /api/admin/digiflazz/price-list?code=SKU
```

Mapping SKU:

```text
POST /api/admin/digiflazz/map-sku
```

```json
{
  "productId": "ml-86",
  "supplierSku": "SKU_DARI_DIGIFLAZZ"
}
```

Mapping memverifikasi SKU langsung ke Digiflazz lalu menyimpan SKU, supplier cost, status, dan waktu sync.

### Supplier price sync

Preview perubahan tanpa menulis database:

```text
POST /api/admin/digiflazz/sync-prices
```

```json
{
  "dryRun": true
}
```

Terapkan semua harga untuk SKU yang sudah dimapping:

```json
{
  "dryRun": false
}
```

Atau batasi produk tertentu:

```json
{
  "productIds": ["ml-86", "ml-172"],
  "dryRun": false
}
```

Sinkronisasi:

- mengambil price list Digiflazz satu kali;
- hanya memproses `supplier_products` yang sudah mempunyai `supplier_sku`;
- memperbarui `supplier_cost`, status produk supplier, dan `last_synced_at`;
- menyimpan history ke `supplier_price_snapshots`;
- melaporkan SKU hilang, perubahan cost, produk inactive, dan base margin yang sudah di bawah minimum profit.

Nambah tidak otomatis menaikkan harga jual pada 0.2.2. Jika supplier cost naik terlalu tinggi, pricing engine akan menolak checkout yang melanggar minimum profit sehingga harga customer tidak berubah diam-diam.

### Test transaction wrapper

```text
POST /api/admin/digiflazz/test-transaction
```

Endpoint ini tetap **TEST-only** dan selalu mengirim `testing: true`.

### Webhook

```text
POST /api/webhooks/digiflazz
```

Webhook memverifikasi `X-Hub-Signature` menggunakan HMAC-SHA1 dan menyimpan event untuk audit callback.

## Security boundary

- Supplier cost, merchant fee, margin, balance, dan credential hanya diproses server-side.
- Public catalog tidak mengirim financial internals.
- Endpoint Digiflazz admin membutuhkan bearer token internal.
- Supplier cost seed tidak dianggap live sampai SKU Digiflazz telah dimapping.
- Transaksi Digiflazz 0.2.x belum memiliki jalur production.
- Semua tabel database tetap RLS-enabled dan browser tidak mendapat direct table access.

## Roadmap berikutnya

- `0.2.3` supplier balance monitoring + Telegram alert
- `0.3.0` Midtrans Sandbox end-to-end
- Admin dashboard
- Affiliate dashboard
- Production hardening
