-- Nambah — fulfillment_target_template untuk gelombang kedua game Digiflazz.
--
-- Semua SKU-nya single-target (customer_no = satu nilai), jadi template cukup
-- {user_id}:
-- - Game ID numerik: aniimo, arena-of-valor, delta-force, fc-mobile,
--   free-fire-max, marvel-rivals.
-- - Game Riot (Riot ID Nama#Tag): league-of-legends-wild-rift,
--   legends-of-runeterra.
-- - Point Blank: login ID alfanumerik.
-- - Voucher kode redeem (SN kode = produk; customer_no = kontak referensi):
--   efootball, garena, google-play-indonesia, playstation, steam-wallet-idr.
--   steam-wallet sudah diset di migration 020.

update public.games set fulfillment_target_template = '{user_id}' where id in (
  'aniimo',
  'arena-of-valor',
  'delta-force',
  'fc-mobile',
  'free-fire-max',
  'marvel-rivals',
  'league-of-legends-wild-rift',
  'legends-of-runeterra',
  'point-blank',
  'efootball',
  'garena',
  'google-play-indonesia',
  'playstation',
  'steam-wallet-idr'
);
