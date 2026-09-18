-- Nambah 0.4.19 — customer profile.

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  whatsapp text,
  preferred_receipt_channel text not null default 'email'
    check (preferred_receipt_channel in ('email','whatsapp','both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
revoke all on table public.customer_profiles from anon, authenticated;
