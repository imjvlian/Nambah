-- Nambah 1.0.10 — seed fulfillment_target_template per game.
--
-- Tanpa template ini live fulfillment diblokir readiness check ("Null keeps
-- live fulfillment blocked"). Placeholder yang didukung: {user_id}, {server_id}.
--
-- Catatan per game:
-- - mobile-legends: Digiflazz mengharapkan customer_no = UserID+ZoneID
--   digabung tanpa pemisah.
-- - genshin-impact: SKU Digiflazz umumnya sudah per-server, jadi customer_no
--   cukup UID. Kalau ada SKU yang mengharapkan server di customer_no, set
--   override per-produk: {user_id}{server_id}.
-- - valorant: customer_no = Riot ID (Nama#Tag) apa adanya.
-- - free-fire, pubg-mobile, honor-of-kings, roblox, steam-wallet: ID saja.

update public.games set fulfillment_target_template = '{user_id}{server_id}' where id = 'mobile-legends';
update public.games set fulfillment_target_template = '{user_id}' where id = 'genshin-impact';
update public.games set fulfillment_target_template = '{user_id}' where id = 'free-fire';
update public.games set fulfillment_target_template = '{user_id}' where id = 'pubg-mobile';
update public.games set fulfillment_target_template = '{user_id}' where id = 'honor-of-kings';
update public.games set fulfillment_target_template = '{user_id}' where id = 'valorant';
update public.games set fulfillment_target_template = '{user_id}' where id = 'roblox';
update public.games set fulfillment_target_template = '{user_id}' where id = 'steam-wallet';
