-- Nambah 0.4.5 — customer account order lookup.
-- Auth users remain managed by Supabase Auth; no duplicate password/profile table
-- is created in public schema. Orders already contain customer_user_id.

create index if not exists orders_customer_user_created_idx
  on public.orders(customer_user_id, created_at desc)
  where customer_user_id is not null;

comment on column public.orders.customer_user_id is
  'Supabase Auth user UUID when the order was created while signed in; null for guest checkout.';
