-- Nambah 0.3.12 — ONE-TIME DEVELOPMENT RESET
--
-- Jalankan hanya di project Supabase KHUSUS Nambah yang masih tahap development.
-- Script ini sengaja BUKAN migration karena fungsinya menghapus data development,
-- bukan mengubah schema.
--
-- Yang dipertahankan:
--   payment_methods
--   suppliers
--   supplier_balances
--   pricing_rules
--   promotions
--   affiliates
--
-- Yang dibersihkan:
--   katalog Nambah + mapping/cache Digiflazz
--   order/payment/supplier transaction sandbox
--   Midtrans event sandbox
--   commission/withdrawal test
--   supplier balance/webhook history test
--
-- Setelah berhasil:
--   1. buka /admin/digiflazz
--   2. Scan ulang Digiflazz (cukup sekali setelah rate-limit pulih)
--   3. pilih SKU yang ingin dijual
--   4. aktifkan "Tampilkan ke user"
-- Nambah akan membuat game, product, mapping, dan harga dari SKU yang dipilih.

begin;

-- `games` adalah akar domain katalog. CASCADE akan membersihkan seluruh data
-- development yang bergantung pada game/product/order, termasuk:
-- products, supplier_products, supplier_price_snapshots, promotion_products,
-- orders, payments, supplier_transactions, commissions, dan
-- midtrans_payment_events.
truncate table public.games restart identity cascade;

-- Cache supplier harus kosong supaya scan berikutnya benar-benar menjadi baseline baru.
truncate table public.supplier_catalog_items restart identity;

-- Bersihkan histori/test yang tidak bergantung pada katalog.
truncate table public.supplier_balance_snapshots restart identity;
truncate table public.supplier_webhook_events restart identity;
truncate table public.affiliate_withdrawals restart identity;

commit;

-- Verifikasi cepat. Nilai katalog/data test di bawah seharusnya 0.
select 'games' as table_name, count(*) as rows from public.games
union all select 'products', count(*) from public.products
union all select 'supplier_products', count(*) from public.supplier_products
union all select 'supplier_catalog_items', count(*) from public.supplier_catalog_items
union all select 'supplier_price_snapshots', count(*) from public.supplier_price_snapshots
union all select 'orders', count(*) from public.orders
union all select 'payments', count(*) from public.payments
union all select 'supplier_transactions', count(*) from public.supplier_transactions
union all select 'commissions', count(*) from public.commissions
union all select 'affiliate_withdrawals', count(*) from public.affiliate_withdrawals
union all select 'supplier_balance_snapshots', count(*) from public.supplier_balance_snapshots
union all select 'supplier_webhook_events', count(*) from public.supplier_webhook_events
union all select 'midtrans_payment_events', count(*) from public.midtrans_payment_events
order by table_name;
