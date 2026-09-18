# Nambah Release Checklist

Baseline target: **1.0.0**

Gunakan checklist ini untuk release candidate dan production launch.

## A. Code gate

- [ ] `npm ci`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] GitHub Actions green
- [ ] package version sesuai release
- [ ] README version sesuai
- [ ] Developer Reference sesuai
- [ ] tidak ada secret baru di source/commit

## B. Database gate

- [ ] migration repository lengkap
- [ ] schema live mempunyai table/column/function yang dibutuhkan
- [ ] RPC privileged direview
- [ ] SECURITY DEFINER tidak muncul tanpa alasan eksplisit
- [ ] function execute grant direview
- [ ] RLS aktif pada exposed public tables
- [ ] anon/authenticated tidak diberi table access yang tidak diperlukan
- [ ] Supabase Security Advisor direview
- [ ] Supabase Performance Advisor direview
- [ ] foreign key penting mempunyai covering index

## C. Staging gate

- [ ] Admin → System: staging blockers = 0
- [ ] homepage/catalog smoke test PASS
- [ ] auth PASS
- [ ] account checker PASS
- [ ] pricing PASS
- [ ] Midtrans Sandbox PASS
- [ ] Test Lab success PASS
- [ ] Test Lab failed PASS
- [ ] Test Lab pending-success PASS
- [ ] Test Lab pending-failed PASS
- [ ] duplicate webhook/idempotency PASS
- [ ] reconciliation PASS
- [ ] Nambah Points PASS
- [ ] Points expiry PASS
- [ ] promotion lifecycle PASS
- [ ] affiliate commission PASS
- [ ] affiliate withdrawal PASS
- [ ] receipt PASS
- [ ] finance reconciliation PASS
- [ ] Operations Center PASS
- [ ] admin security PASS

## D. Production provider configuration

- [ ] Midtrans Production Server Key installed
- [ ] Midtrans Production Client Key installed
- [ ] `MIDTRANS_ENVIRONMENT=production`
- [ ] `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT=production`
- [ ] Midtrans Payment Notification URL benar
- [ ] Digiflazz credential production benar
- [ ] Digiflazz callback URL benar
- [ ] Digiflazz webhook secret benar
- [ ] Supabase Auth Site URL production
- [ ] Supabase Redirect URLs production
- [ ] Supabase Leaked Password Protection enabled
- [ ] Brevo sender/domain verified
- [ ] Telegram test alert berhasil

## E. Catalog live gate

- [ ] semua product yang akan live mempunyai active supplier mapping
- [ ] semua product yang akan live mempunyai verified fulfillment target template
- [ ] SKU provider diperiksa
- [ ] supplier current price diperiksa
- [ ] frozen max-price behavior diuji
- [ ] target account representative diuji per format game

Jangan mengisi target template dengan tebakan.

## F. Operations gate

- [ ] `CRON_SECRET` configured
- [ ] reconciliation scheduler configured
- [ ] financial reconciliation scheduler configured
- [ ] balance scheduler configured
- [ ] Points expiry scheduler configured
- [ ] operations-health scheduler configured
- [ ] Operations Center tidak mempunyai unexplained critical incident
- [ ] financial reconciliation tidak mempunyai unexplained critical mismatch
- [ ] supplier balance cukup untuk controlled launch

## G. Secret gate

- [ ] rotate secret/key yang pernah masuk chat
- [ ] rotate secret/key yang pernah masuk screenshot
- [ ] rotate secret/key yang pernah masuk log publik
- [ ] verify no service-role key in browser
- [ ] admin session secret random dan server-only
- [ ] rate-limit secret random dan server-only
- [ ] cron secret random dan server-only

## H. Real-money gate

Versi 1.0.0 **tidak** mengaktifkan bagian ini otomatis.

Owner harus menyetujui secara eksplisit sebelum:

~~~env
NAMBAH_FLOW_TEST_MODE=false
NAMBAH_FULFILLMENT_MODE=digiflazz-live
NAMBAH_ALLOW_LIVE_FULFILLMENT=true
NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE
~~~

Checklist:

- [ ] owner explicit approval
- [ ] semua production blockers dipahami/ditutup
- [ ] pilih nominal real terkecil
- [ ] traffic dibatasi
- [ ] transaksi real pertama berhasil
- [ ] Midtrans dashboard cocok
- [ ] Digiflazz dashboard cocok
- [ ] supplier SN tercatat
- [ ] receipt benar
- [ ] Points benar
- [ ] affiliate commission benar
- [ ] finance reconciliation benar

## I. Rollback gate

Jika payment/fulfillment tidak dapat dijelaskan:

1. set `NAMBAH_ALLOW_LIVE_FULFILLMENT=false`;
2. jangan hapus verified payment record;
3. hentikan traffic baru bila perlu;
4. cek `/admin/operations`;
5. cek order detail;
6. jalankan reconciliation hanya melalui jalur idempotent;
7. jangan resend supplier manual sampai request lama dipastikan terminal/tidak terkirim;
8. rollback deployment jika regression berasal dari app release;
9. dokumentasikan incident;
10. hanya reopen setelah staging reproduction + fix PASS.

## J. Release sign-off

Catat:

~~~text
Release:
Commit:
CI run:
Database migration baseline:
Staging tested by:
Production approved by:
First live order ID:
Known non-blocking issues:
Rollback version:
~~~

Simpan sign-off bersama release notes.
