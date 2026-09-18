-- Nambah 0.4.22 — explicit Digiflazz live fulfillment target formatting.

alter table public.games
  add column if not exists fulfillment_target_template text;

alter table public.products
  add column if not exists fulfillment_target_template text;

comment on column public.games.fulfillment_target_template is
  'Explicit Digiflazz customer_no template. Supported placeholders: {user_id}, {server_id}. Null keeps live fulfillment blocked.';
comment on column public.products.fulfillment_target_template is
  'Optional product-level override for Digiflazz customer_no template.';
