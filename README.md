# Nambah

Nambah adalah web top up digital berbasis Next.js. Arsitektur MVP menggunakan Midtrans untuk payment gateway, Digiflazz sebagai supplier awal, dan Supabase PostgreSQL sebagai database.

## Status

`0.2.0` — database foundation.

Saat credential Supabase belum diisi, aplikasi otomatis memakai static catalog/pricing fallback sehingga flow frontend tetap bisa dites.

## Development

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Supabase setup

Gunakan **project Supabase khusus Nambah**. Jangan gunakan database project lain.

1. Buat project Supabase baru.
2. Jalankan `supabase/schema.sql` di SQL Editor.
3. Jalankan `supabase/seed.sql` setelah schema berhasil.
4. Copy `.env.example` menjadi `.env.local`.
5. Isi server credential project Nambah:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

`SUPABASE_SECRET_KEY` hanya boleh digunakan server-side dan tidak boleh diberi prefix `NEXT_PUBLIC_`.

`NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` disiapkan untuk milestone Supabase Auth berikutnya dan belum diperlukan untuk katalog/pricing 0.2.0.

### Database behavior

- Tanpa `SUPABASE_URL` + `SUPABASE_SECRET_KEY`: katalog/pricing memakai static fallback.
- Dengan credential lengkap: homepage membaca game, produk, metode pembayaran, promo, referral, supplier cost, dan pricing rules dari Supabase.
- Supplier cost, margin, balance supplier, commission internal, dan financial records tidak dikirim mentah ke browser.
- Browser tidak mendapat direct table access pada 0.2.0; semua tabel public-schema tetap RLS-enabled dan akses dilakukan melalui Next.js server.

`supabase/schema.sql` masih berupa **bootstrap schema**, bukan migration history. Setelah project Nambah benar-benar dibuat dan schema diverifikasi, buat migration resmi menggunakan Supabase CLI dari state project tersebut.

## Database foundation

Schema 0.2.0 mencakup:

- games
- products
- payment_methods
- suppliers
- supplier_products
- pricing_rules
- promotions + promotion_products
- affiliates
- supplier_balances + supplier_balance_snapshots
- orders
- payments
- supplier_transactions
- commissions
- affiliate_withdrawals

## Roadmap berikutnya

- `0.2.1` Digiflazz TEST integration
- `0.2.2` supplier price sync + pricing production rules
- `0.2.3` supplier balance monitoring + Telegram alert
- `0.3.0` Midtrans Sandbox end-to-end
- Admin dashboard
- Affiliate dashboard
- Production hardening
