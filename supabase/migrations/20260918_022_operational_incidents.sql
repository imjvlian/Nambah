-- Nambah 0.5.5 — operational incident tracking.
create table if not exists public.operational_incidents (
  fingerprint text primary key,
  kind text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','resolved')),
  title text not null,
  detail text not null,
  entity_type text,
  entity_id text,
  occurrence_count bigint not null default 1 check (occurrence_count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists operational_incidents_status_severity_idx
  on public.operational_incidents(status,severity,last_seen_at desc);
alter table public.operational_incidents enable row level security;
revoke all on table public.operational_incidents from public,anon,authenticated;
grant select,insert,update,delete on table public.operational_incidents to service_role;
