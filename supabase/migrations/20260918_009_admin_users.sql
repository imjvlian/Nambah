-- Nambah 0.4.6 — role-based admin accounts.
-- Admins authenticate through the same Supabase Auth account system used by
-- customers. This table only stores authorization; it never stores passwords.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_users_active_role_idx
  on public.admin_users(active, role);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

comment on table public.admin_users is
  'Server-only authorization map for Nambah admin accounts. Authentication remains in Supabase Auth.';
