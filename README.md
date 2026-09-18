# Nambah

Nambah adalah web top-up digital berbasis Next.js 16 dengan Supabase PostgreSQL, Midtrans, Digiflazz, Brevo, loyalty Points, promo, dan affiliate.

## Status

**0.9.0 — Release Candidate**

Core flow tersedia:

```text
catalog → account validation → pricing → promo/referral/points
→ Midtrans → verified payment → Digiflazz fulfillment
→ webhook/reconciliation → receipt → affiliate/finance/admin
```

Staging Test Lab tersedia di `/admin/test-lab` untuk memilih scenario Digiflazz `testing:true` tanpa mengubah ENV/redeploy. Live money **tidak aktif otomatis**. Default Midtrans adalah sandbox dan Digiflazz live memiliki double explicit opt-in.

Deployment staging saat ini:

```text
https://nambah.vercel.app
```

## Development

```bash
npm ci
npm run dev
npm run test
npm run build
```

## Database

Jangan gunakan `supabase/seed.sql` untuk meng-upgrade database existing karena seed dapat menimpa data katalog/price/active state.

Migration fitur terbaru:

```text
012 Nambah Points
013 Affiliate commissions
014 Promotion management
015 Customer profiles
016 Live fulfillment targets
017 Financial reconciliation
018 Production hardening
019 Staging Test Lab + operational indexes
020 Points lots + expiry
021 Points reverse/reservation consistency
022 Operational incidents
023 Admin principal audit
024 Affiliate withdrawal workflow
```

## Dokumentasi

- [Developer Reference](./DEVELOPER_REFERENCE.md) — architecture, API, service, database, invariants.
- [Environment Guide](./ENVIRONMENT_GUIDE.md) — local, staging, production, secret dan live-money gate.
- [Test Guide](./TEST_GUIDE.md) — automated + manual E2E regression.
- [Release Checklist](./RELEASE_CHECKLIST.md) — sign-off, launch dan rollback.
- [Production Guide](./PRODUCTION.md) — deployment dan controlled production launch.
- [Changelog](./CHANGELOG.md) — milestone release.

Default scheduled operations untuk Vercel didefinisikan di `vercel.json`. Semua endpoint cron tetap memerlukan `CRON_SECRET`.

Versi 1.0.0 tidak identik dengan live-money ON; activation provider production tetap mempunyai gate operasional terpisah.

## Environment penting

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

MIDTRANS_ENVIRONMENT=sandbox
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=sandbox
MIDTRANS_SERVER_KEY=
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=

DIGIFLAZZ_USERNAME=
DIGIFLAZZ_API_KEY=
DIGIFLAZZ_WEBHOOK_SECRET=
DIGIFLAZZ_CALLBACK_URL=

BREVO_RECEIPT_ENABLED=false
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Nambah

NAMBAH_ADMIN_SESSION_SECRET=
NAMBAH_RATE_LIMIT_SECRET=
CRON_SECRET=
```

Lihat `.env.example` untuk seluruh opsi.

## Safety boundaries

- Browser tidak menerima supplier cost atau server credentials.
- Midtrans payment status diverifikasi server-side; callback browser bukan sumber kebenaran.
- Digiflazz menggunakan deterministic request ref, signed callback, terminal guards, reconciliation, dan frozen max price.
- Points memakai atomic ledger/reservation untuk mencegah double-spend.
- Promo quota memakai reservation lifecycle.
- Affiliate commission mengikuti status order dan net profit.
- Financial reconciliation hanya mendeteksi mismatch; tidak memindahkan uang otomatis.
- Admin mutations penting dicatat ke audit log.
- Login/signup/checker/order creation memakai durable rate limiting.
- Live Digiflazz tetap terkunci sampai explicit production opt-in.
