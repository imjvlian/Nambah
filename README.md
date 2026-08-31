# Nambah

Nambah adalah web top up digital berbasis Next.js. MVP memakai Midtrans untuk pembayaran, Digiflazz sebagai supplier awal, dan Supabase PostgreSQL sebagai database.

## Status

`0.3.0` — Midtrans Sandbox end-to-end.

Pada milestone ini order pembayaran sudah disimpan server-side, Snap token dibuat oleh backend, status pembayaran dapat diperbarui dari webhook Midtrans atau Get Status API, dan halaman order membaca status dari database. Transaksi Digiflazz production tetap belum diaktifkan.

## Development

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Supabase

Gunakan project Supabase khusus Nambah.

Urutan instalasi database:

1. `supabase/schema.sql`
2. `supabase/seed.sql`
3. `supabase/migrations/20260831_001_digiflazz_test.sql`
4. `supabase/migrations/20260831_002_supplier_price_sync.sql`
5. `supabase/migrations/20260831_003_supplier_balance_monitor.sql`
6. `supabase/migrations/20260831_004_midtrans_sandbox.sql`

Server credential:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

## Digiflazz

```env
NAMBAH_ADMIN_API_TOKEN=buat-token-random-panjang
CRON_SECRET=buat-secret-cron-random
DIGIFLAZZ_USERNAME=username-buyer
DIGIFLAZZ_API_KEY=api-key-buyer
DIGIFLAZZ_WEBHOOK_SECRET=secret-webhook
DIGIFLAZZ_CALLBACK_URL=https://domain-kamu.com/api/webhooks/digiflazz
TELEGRAM_BOT_TOKEN=token-bot
TELEGRAM_ADMIN_CHAT_ID=chat-id
```

Semua credential di atas server-only.

### Supplier price sync

Preview:

```text
POST /api/admin/digiflazz/sync-prices
{"dryRun":true}
```

Apply:

```text
POST /api/admin/digiflazz/sync-prices
{"dryRun":false}
```

### Supplier balance

Manual check:

```text
POST /api/admin/digiflazz/balance
{"notify":false}
```

Periodic check:

```text
GET /api/cron/digiflazz-balance
Authorization: Bearer <CRON_SECRET>
```

## Midtrans Sandbox

Ambil Sandbox Server Key dan Client Key dari Midtrans MAP, lalu tambahkan ke `.env.local`:

```env
MIDTRANS_SERVER_KEY=SB-Mid-server-...
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=SB-Mid-client-...
```

`MIDTRANS_SERVER_KEY` tidak boleh diberi prefix `NEXT_PUBLIC_`.

0.3.0 sengaja menggunakan endpoint Sandbox secara hard-coded:

```text
https://app.sandbox.midtrans.com/snap/v1/transactions
https://api.sandbox.midtrans.com/v2/{order_id}/status
```

Tidak ada endpoint Midtrans production pada milestone ini.

### Flow checkout

```text
Customer memilih produk
→ server validasi pricing ulang
→ order + payment pending disimpan ke Supabase
→ backend membuat Snap token Sandbox
→ customer membuka Snap
→ Midtrans memproses pembayaran Sandbox
→ webhook / Get Status diverifikasi backend
→ orders.status diperbarui
```

Endpoint customer:

```text
POST /api/orders
GET  /api/orders/{id}
POST /api/orders/{id}/refresh
```

Webhook Midtrans:

```text
POST /api/webhooks/midtrans
```

Webhook diverifikasi memakai:

```text
SHA512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
```

Callback `snap.pay()` di browser tidak pernah dipakai untuk menetapkan order sebagai paid. Callback hanya memicu `/api/orders/{id}/refresh`, yang mengecek status langsung ke Midtrans menggunakan Server Key.

Untuk webhook ketika development masih di localhost, gunakan URL HTTPS publik/tunnel lalu set Notification URL Midtrans ke:

```text
https://PUBLIC_DOMAIN/api/webhooks/midtrans
```

Tanpa tunnel, flow Sandbox tetap dapat divalidasi dari tombol/Callback Get Status karena backend akan meminta status langsung ke Midtrans.

### Mapping status pembayaran

- `settlement` → order `paid`
- `capture` + fraud accepted → order `paid`
- `pending` → tetap `pending_payment`
- `deny` → tetap `pending_payment` agar Snap masih dapat dicoba ulang
- `expire` / `cancel` → `cancelled`
- `failure` → `failed`
- `refund` / `partial_refund` → `refunded`

Setiap webhook/Get Status yang berhasil diproses disimpan ke `midtrans_payment_events` untuk audit.

## Security boundary

- Supplier cost, merchant payment cost, margin, Server Key, Digiflazz credential, dan Telegram token hanya berada di server.
- Browser hanya menerima harga customer-safe, Snap token transaksi, redirect URL, dan status order.
- Midtrans webhook wajib lolos signature SHA-512.
- Gross amount Midtrans harus sama dengan snapshot `orders.final_price` sebelum status diterapkan.
- Status pembayaran tidak dipercaya dari callback browser.
- Semua tabel database tetap RLS-enabled dan browser tidak mendapat direct table access.
- Digiflazz production transaction belum tersedia pada 0.3.0.

## Roadmap berikutnya

- `0.3.x` order orchestration: reserve supplier balance, payment-success → Digiflazz, pending/retry/refund
- `0.4.0` admin dashboard
- `0.5.0` affiliate dashboard
- `0.9.0` production hardening
- `1.0.0` production release
