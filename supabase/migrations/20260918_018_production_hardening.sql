-- Nambah 0.4.24 — durable abuse guard + admin audit log.

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  hit_count integer not null default 0 check (hit_count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_buckets_expires_idx
  on public.rate_limit_buckets(expires_at);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_kind text not null check (actor_kind in ('admin_session','legacy_bearer')),
  action text not null,
  target_type text,
  target_id text,
  method text not null,
  path text not null,
  client_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);

create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs(target_type,target_id,created_at desc);

alter table public.rate_limit_buckets enable row level security;
alter table public.admin_audit_logs enable row level security;
revoke all on table public.rate_limit_buckets from anon, authenticated;
revoke all on table public.admin_audit_logs from anon, authenticated;
revoke usage, select on sequence public.admin_audit_logs_id_seq from anon, authenticated;

create or replace function public.nambah_rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.rate_limit_buckets%rowtype;
  v_now timestamptz := now();
begin
  if p_key is null or length(p_key) < 16 then
    raise exception 'Rate limit key invalid.';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Rate limit configuration invalid.';
  end if;

  insert into public.rate_limit_buckets(
    bucket_key,
    hit_count,
    expires_at,
    updated_at
  )
  values(
    p_key,
    1,
    v_now + make_interval(secs => p_window_seconds),
    v_now
  )
  on conflict (bucket_key) do update
  set hit_count = case
        when public.rate_limit_buckets.expires_at <= v_now then 1
        else public.rate_limit_buckets.hit_count + 1
      end,
      expires_at = case
        when public.rate_limit_buckets.expires_at <= v_now
          then v_now + make_interval(secs => p_window_seconds)
        else public.rate_limit_buckets.expires_at
      end,
      updated_at = v_now
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.hit_count <= p_limit,
    'count', v_row.hit_count,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - v_row.hit_count),
    'resetAt', v_row.expires_at
  );
end;
$$;

revoke all on function public.nambah_rate_limit_hit(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.nambah_rate_limit_hit(text,integer,integer)
  to service_role;
