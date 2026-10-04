-- Nambah 0.5.7 — bind audit events to signed admin principals.
alter table public.admin_audit_logs
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_role text
    check (actor_role is null or actor_role in ('admin','superadmin','legacy'));

create index if not exists admin_audit_logs_actor_user_created_idx
  on public.admin_audit_logs(actor_user_id,created_at desc)
  where actor_user_id is not null;
