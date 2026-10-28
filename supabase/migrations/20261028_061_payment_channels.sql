-- ============================================================================
-- 061 - Metode pembayaran lengkap: kanal per-kanal Midtrans di checkout
--
-- Keputusan owner 28 Okt 2026:
--   D1 Checkout menawarkan KANAL langsung (GoPay, DANA, VA BCA, ...), bukan
--      genus lalu daftar lagi di Snap. `enabled_payments` dipanggang berisi
--      SATU kanal, dan Midtrans Snap langsung menampilkan flow metode itu
--      tanpa halaman daftar (docs.midtrans.com — Snap advanced feature).
--   D2 Hanya kanal yang terbukti aktif di kode sekarang yang dibuat aktif:
--      gopay, shopeepay, dana, ovo, qris (via `other_qris`), dan VA per-bank
--      yang dicakup alias `bank_transfer`. Minimarket/kartu kredit dibuat
--      NON-AKTIF sampai owner konfirmasi aktivisasi di dashboard Midtrans.
--   D3 Tiga baris generik lama: `qris` menjabat jadi baris kanal QRIS;
--      `ewallet` dan `va` NON-AKTIF. Id dipertahankan — order historis
--      masih menunjuk mereka (read jalur order tidak menyaring `active`).
--   D4 Semua customer_fee = 0: biaya layanan gateway 100% diterjunkan ke
--      pembeli oleh Midtrans (Automatic Fee Imposition) dan dihitung di
--      halaman pembayaran, bukan oleh app. Fee 0 di baris QRIS juga
--      mematuhi larangan BI tentang surcharge pembayaran QRIS.
--
-- Idempoten. Tidak ada perubahan skema.
--
-- URUTAN RILIS: apply file ini DULU, lalu deploy kode (`git pull && npm ci
-- && npm run build && sudo systemctl restart nambah`). Kode lama masih
-- aman terhadap baris baru: `MIDTRANS_PAYMENT_MAP` tidak punya entri untuk
-- id baru, jadi jalur yang tidak dipilih user tidak pernah menyentuhnya.
-- ============================================================================

insert into public.payment_methods (
  id, name, detail, customer_fee_flat, customer_fee_percent,
  merchant_fee_flat, merchant_fee_percent, active, sort_order
) values
  ('gopay', 'GoPay', 'Konfirmasi di aplikasi Gojek/GoPay', 0, 0, 0, 0, true, 20),
  ('shopeepay', 'ShopeePay', 'Konfirmasi di aplikasi Shopee', 0, 0, 0, 0, true, 30),
  ('dana', 'DANA', 'Konfirmasi di aplikasi DANA', 0, 0, 0, 0, true, 40),
  ('ovo', 'OVO', 'Konfirmasi di aplikasi OVO', 0, 0, 0, 0, true, 50),
  ('bca_va', 'VA BCA', 'Transfer ke nomor Virtual Account BCA', 0, 0, 0, 0, true, 60),
  ('bni_va', 'VA BNI', 'Transfer ke nomor Virtual Account BNI', 0, 0, 0, 0, true, 70),
  ('bri_va', 'VA BRI', 'Transfer ke nomor Virtual Account BRI', 0, 0, 0, 0, true, 80),
  ('permata_va', 'VA Permata', 'Transfer ke nomor Virtual Account Permata', 0, 0, 0, 0, true, 90),
  ('echannel', 'VA Mandiri', 'Bayar via ATM/internet banking Mandiri (Mandiri Bill)', 0, 0, 0, 0, true, 100),
  ('indomaret', 'Indomaret', 'Bayar di kasir Indomaret', 0, 0, 0, 0, false, 110),
  ('alfamart', 'Alfamart', 'Bayar di kasir Alfamart', 0, 0, 0, 0, false, 120),
  ('credit_card', 'Kartu Kredit/Debit', 'Visa, Mastercard, JCB', 0, 0, 0, 0, false, 130)
on conflict (id) do update set
  name = excluded.name,
  detail = excluded.detail,
  customer_fee_flat = excluded.customer_fee_flat,
  customer_fee_percent = excluded.customer_fee_percent,
  merchant_fee_flat = excluded.merchant_fee_flat,
  merchant_fee_percent = excluded.merchant_fee_percent,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Baris `qris` menjabat jadi baris kanal QRIS (checkout memanggil
-- `other_qris` karena acquirer QRIS diganggung Midtrans).
update public.payment_methods
set active = true, sort_order = 10, updated_at = now()
where id = 'qris';

-- Tiga baris generik lama dinon-aktifkan: genus-nya dipecah ke kanal sendiri.
-- `ewallet` dan `va` tetap menolak cek-audience di halaman checkout aktif;
-- id tidak dihapus karena order historis menunjuk mereka.
update public.payment_methods
set active = false, updated_at = now()
where id in ('ewallet', 'va');
