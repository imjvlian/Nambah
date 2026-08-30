-- Nambah MVP seed. Safe to re-run.

insert into public.suppliers (id, name, active)
values ('digiflazz', 'Digiflazz', true)
on conflict (id) do update set name = excluded.name, active = excluded.active, updated_at = now();

insert into public.games (id, name, short_name, category, accent, initials, requires_server, active, sort_order) values
  ('mobile-legends', 'Mobile Legends', 'MLBB', 'game', '#78a7ff', 'ML', true, true, 10),
  ('free-fire', 'Free Fire', 'Free Fire', 'game', '#ff9f42', 'FF', false, true, 20),
  ('pubg-mobile', 'PUBG Mobile', 'PUBG', 'game', '#f4c44e', 'PB', false, true, 30),
  ('valorant', 'Valorant', 'Valorant', 'voucher', '#ff6675', 'VL', false, true, 40),
  ('honor-of-kings', 'Honor of Kings', 'HOK', 'game', '#e5b866', 'HK', false, true, 50),
  ('genshin-impact', 'Genshin Impact', 'Genshin', 'game', '#89d4e3', 'GI', true, true, 60),
  ('roblox', 'Roblox', 'Roblox', 'voucher', '#b9bec8', 'RB', false, true, 70),
  ('steam-wallet', 'Steam Wallet', 'Steam', 'voucher', '#7fc2ff', 'ST', false, true, 80)
on conflict (id) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  category = excluded.category,
  accent = excluded.accent,
  initials = excluded.initials,
  requires_server = excluded.requires_server,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.products (id, game_id, label, note, selling_price, reference_price, active, sort_order) values
  ('ml-5', 'mobile-legends', '5 Diamonds', null, 2000, 2500, true, 10),
  ('ml-12', 'mobile-legends', '12 Diamonds', null, 4500, 5000, true, 20),
  ('ml-28', 'mobile-legends', '28 Diamonds', null, 8500, 10000, true, 30),
  ('ml-86', 'mobile-legends', '86 Diamonds', 'Populer', 21500, 24000, true, 40),
  ('ml-172', 'mobile-legends', '172 Diamonds', null, 42000, 47000, true, 50),
  ('ml-wdp', 'mobile-legends', 'Weekly Diamond Pass', 'Hemat', 27000, 31000, true, 60),
  ('ff-5', 'free-fire', '5 Diamonds', null, 1500, 2000, true, 10),
  ('ff-20', 'free-fire', '20 Diamonds', null, 4000, 5000, true, 20),
  ('ff-50', 'free-fire', '50 Diamonds', null, 8000, 9000, true, 30),
  ('ff-100', 'free-fire', '100 Diamonds', 'Populer', 12000, 14000, true, 40),
  ('ff-210', 'free-fire', '210 Diamonds', null, 23000, 26000, true, 50),
  ('ff-membership', 'free-fire', 'Weekly Membership', null, 29000, 33000, true, 60),
  ('pubg-60', 'pubg-mobile', '60 UC', null, 16000, 18000, true, 10),
  ('pubg-325', 'pubg-mobile', '325 UC', 'Populer', 76000, 85000, true, 20),
  ('pubg-660', 'pubg-mobile', '660 UC', null, 147000, 160000, true, 30),
  ('pubg-1800', 'pubg-mobile', '1800 UC', null, 365000, 395000, true, 40),
  ('valo-125', 'valorant', '125 Points', null, 16000, 18000, true, 10),
  ('valo-420', 'valorant', '420 Points', 'Populer', 47000, 52000, true, 20),
  ('valo-700', 'valorant', '700 Points', null, 74000, 81000, true, 30),
  ('valo-1375', 'valorant', '1375 Points', null, 144000, 158000, true, 40),
  ('hok-16', 'honor-of-kings', '16 Tokens', null, 4000, 5000, true, 10),
  ('hok-80', 'honor-of-kings', '80 Tokens', null, 16000, 18000, true, 20),
  ('hok-240', 'honor-of-kings', '240 Tokens', 'Populer', 45000, 50000, true, 30),
  ('hok-weekly', 'honor-of-kings', 'Weekly Card', null, 22000, 25000, true, 40),
  ('gi-60', 'genshin-impact', '60 Genesis Crystals', null, 15000, 17000, true, 10),
  ('gi-300', 'genshin-impact', '300 + 30 Crystals', null, 70000, 77000, true, 20),
  ('gi-welkin', 'genshin-impact', 'Blessing of the Welkin Moon', 'Populer', 64000, 70000, true, 30),
  ('rb-50', 'roblox', '50 Robux', null, 10000, 12000, true, 10),
  ('rb-100', 'roblox', '100 Robux', null, 19000, 22000, true, 20),
  ('rb-400', 'roblox', '400 Robux', 'Populer', 73000, 80000, true, 30),
  ('steam-12', 'steam-wallet', 'Steam Wallet IDR 12.000', null, 13500, 15000, true, 10),
  ('steam-45', 'steam-wallet', 'Steam Wallet IDR 45.000', null, 48000, 52000, true, 20),
  ('steam-90', 'steam-wallet', 'Steam Wallet IDR 90.000', 'Populer', 95000, 102000, true, 30)
on conflict (id) do update set
  game_id = excluded.game_id,
  label = excluded.label,
  note = excluded.note,
  selling_price = excluded.selling_price,
  reference_price = excluded.reference_price,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.supplier_products (supplier_id, product_id, supplier_sku, supplier_cost, active) values
  ('digiflazz', 'ml-5', null, 1500, true),
  ('digiflazz', 'ml-12', null, 3500, true),
  ('digiflazz', 'ml-28', null, 7500, true),
  ('digiflazz', 'ml-86', null, 19500, true),
  ('digiflazz', 'ml-172', null, 39000, true),
  ('digiflazz', 'ml-wdp', null, 24000, true),
  ('digiflazz', 'ff-5', null, 900, true),
  ('digiflazz', 'ff-20', null, 3000, true),
  ('digiflazz', 'ff-50', null, 6500, true),
  ('digiflazz', 'ff-100', null, 10000, true),
  ('digiflazz', 'ff-210', null, 20500, true),
  ('digiflazz', 'ff-membership', null, 26000, true),
  ('digiflazz', 'pubg-60', null, 14000, true),
  ('digiflazz', 'pubg-325', null, 70000, true),
  ('digiflazz', 'pubg-660', null, 138000, true),
  ('digiflazz', 'pubg-1800', null, 345000, true),
  ('digiflazz', 'valo-125', null, 14000, true),
  ('digiflazz', 'valo-420', null, 43000, true),
  ('digiflazz', 'valo-700', null, 69000, true),
  ('digiflazz', 'valo-1375', null, 135000, true),
  ('digiflazz', 'hok-16', null, 3000, true),
  ('digiflazz', 'hok-80', null, 14000, true),
  ('digiflazz', 'hok-240', null, 41000, true),
  ('digiflazz', 'hok-weekly', null, 19000, true),
  ('digiflazz', 'gi-60', null, 13000, true),
  ('digiflazz', 'gi-300', null, 65000, true),
  ('digiflazz', 'gi-welkin', null, 59000, true),
  ('digiflazz', 'rb-50', null, 8500, true),
  ('digiflazz', 'rb-100', null, 17000, true),
  ('digiflazz', 'rb-400', null, 68000, true),
  ('digiflazz', 'steam-12', null, 12000, true),
  ('digiflazz', 'steam-45', null, 45000, true),
  ('digiflazz', 'steam-90', null, 90000, true)
on conflict (supplier_id, product_id) do update set
  supplier_cost = excluded.supplier_cost,
  active = excluded.active,
  updated_at = now();

insert into public.payment_methods (
  id, name, detail, customer_fee_flat, customer_fee_percent,
  merchant_fee_flat, merchant_fee_percent, active, sort_order
) values
  ('qris', 'QRIS', 'Semua aplikasi pembayaran', 0, 0, 0, 0, true, 10),
  ('ewallet', 'E-Wallet', 'GoPay, DANA, ShopeePay dan lainnya', 0, 0, 0, 0, true, 20),
  ('va', 'Virtual Account', 'Transfer bank otomatis', 0, 0, 0, 0, true, 30)
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

insert into public.pricing_rules (
  id, minimum_nambah_profit, default_affiliate_rate,
  target_supplier_balance, low_supplier_balance, critical_supplier_balance
) values ('default', 500, 0.20, 500000, 100000, 50000)
on conflict (id) do update set
  minimum_nambah_profit = excluded.minimum_nambah_profit,
  default_affiliate_rate = excluded.default_affiliate_rate,
  target_supplier_balance = excluded.target_supplier_balance,
  low_supplier_balance = excluded.low_supplier_balance,
  critical_supplier_balance = excluded.critical_supplier_balance,
  updated_at = now();

insert into public.promotions (
  code, name, type, value, minimum_order, max_discount,
  stackable_with_referral, active
) values
  ('WELCOME', 'Promo pengguna baru', 'flat', 1000, 20000, null, true, true),
  ('NAMB5', 'Diskon 5%', 'percentage', 5, 25000, 3000, true, true)
on conflict (code) do update set
  name = excluded.name,
  type = excluded.type,
  value = excluded.value,
  minimum_order = excluded.minimum_order,
  max_discount = excluded.max_discount,
  stackable_with_referral = excluded.stackable_with_referral,
  active = excluded.active,
  updated_at = now();

insert into public.affiliates (
  code, display_name, commission_rate, user_benefit_type,
  user_benefit_value, minimum_order, max_user_benefit,
  stackable_with_promotions, status
) values
  ('TEMAN', 'Referral Teman', 0.20, 'flat', 500, 20000, null, true, 'active'),
  ('CREATOR', 'Referral Creator', 0.20, 'percentage', 3, 25000, 1500, true, 'active')
on conflict (code) do update set
  display_name = excluded.display_name,
  commission_rate = excluded.commission_rate,
  user_benefit_type = excluded.user_benefit_type,
  user_benefit_value = excluded.user_benefit_value,
  minimum_order = excluded.minimum_order,
  max_user_benefit = excluded.max_user_benefit,
  stackable_with_promotions = excluded.stackable_with_promotions,
  status = excluded.status,
  updated_at = now();
