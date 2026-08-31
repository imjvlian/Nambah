# Nambah

Nambah adalah web top up digital berbasis Next.js. Arsitektur MVP menggunakan Midtrans untuk payment gateway, Digiflazz sebagai supplier awal, dan Supabase PostgreSQL sebagai database.

## Status

`0.2.3` — supplier balance monitoring + Telegram alert.

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
5. Jalankan `supabase/migrations/20260831_003_supplier_balance_monitor.sql`.

Untuk project yang sudah berada di 0.2.2, cukup jalankan migration `20260831_003_supplier_balance_monitor.sql`.

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
CRON_SECRET=buat-secret-cron-random-panjang

DIGIFLAZZ_USERNAME=username-buyer
DIGIFLAZZ_API_KEY=api-key-buyer
DIGIFLAZZ_WEBHOOK_SECRET=secret-webhook
DIGIFLAZZ_CALLBACK_URL=https://domain-kamu.com/api/webhooks/digiflazz

TELEGRAM_BOT_TOKEN=token-bot
TELEGRAM_ADMIN_CHAT_ID=chat-id-admin
```

Semua nilai di atas server-only. Jangan pernah menambahkan prefix `NEXT_PUBLIC_`.

### Direct test case

Untuk verifikasi API Development Digiflazz langsung dari PowerShell:

```powershell
.\scripts\test-digiflazz.ps1 -Outcome failed
```

Outcome yang tersedia: `success`, `failed`, `pending-success`, dan `pending-failed`.

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

Terapkan harga untuk SKU yang sudah dimapping dengan `dryRun: false`. Sinkronisasi memperbarui supplier cost/status dan menyimpan history ke `supplier_price_snapshots`. Nambah tidak otomatis menaikkan harga jual; pricing engine tetap melindungi minimum profit.

## Supplier balance monitoring

Saldo dibaca melalui API Buyer Digiflazz `cek-saldo`. Nambah menggunakan **available balance** untuk status:

```text
available = balance - reserved_balance
```

Threshold default dari `pricing_rules`:

```text
HEALTHY   > Rp100.000
LOW       <= Rp100.000
CRITICAL  <= Rp50.000
TARGET    Rp500.000
```

Threshold dapat diubah di database tanpa mengubah source code.

Manual check tanpa notifikasi:

```text
POST /api/admin/digiflazz/balance
```

```json
{
  "notify": false
}
```

Respons menyertakan balance, reserved balance, available balance, status, threshold, dan recommended deposit. Setiap check disimpan ke `supplier_balance_snapshots`.

### Telegram

Buat bot lewat BotFather, masukkan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_ADMIN_CHAT_ID`, lalu tes:

```text
POST /api/admin/telegram/test
```

Telegram balance alert memakai state transition anti-spam. Contoh:

```text
Rp99k  HEALTHY -> LOW       kirim alert
Rp80k  LOW     -> LOW       tidak kirim lagi
Rp49k  LOW     -> CRITICAL  kirim alert
Rp150k CRITICAL-> HEALTHY   kirim recovery
```

### Periodic check

Endpoint scheduler:

```text
GET /api/cron/digiflazz-balance
Authorization: Bearer <CRON_SECRET>
```

Endpoint ini melakukan check dengan `notify: true`. Hubungkan ke scheduler hosting setelah Nambah mempunyai URL deployment. Rekomendasi interval safety check adalah setiap 15–30 menit; jangan polling setiap beberapa detik.

Selain periodic check, fungsi balance monitor juga disiapkan dengan source `transaction` agar nanti dapat dipanggil setelah transaksi supplier pada flow production.

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
- Cron monitor memakai secret terpisah dari admin API token.
- Telegram token/chat ID tidak pernah dikirim ke browser.
- Supplier cost seed tidak dianggap live sampai SKU Digiflazz telah dimapping.
- Transaksi Digiflazz 0.2.x belum memiliki jalur production.
- Semua tabel database tetap RLS-enabled dan browser tidak mendapat direct table access.

## Roadmap berikutnya

- `0.3.0` Midtrans Sandbox end-to-end
- Order persistence + webhook state machine
- Admin dashboard
- Affiliate dashboard
- Production hardening
