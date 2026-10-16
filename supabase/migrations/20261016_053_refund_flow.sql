-- ============================================================================
-- 053 - Refund end-to-end
--
-- Order sudah punya status `refunded` sejak awal, tapi belum ada tempat untuk
-- mencatat SIAPA yang memproses refund, BERAPA nominal yang dikembalikan,
-- dan dari gateway mana pengembalian itu dikirim. Tanpa tabel ini, refund
-- hanya bisa dilakukan manual di dashboard payment gateway dan tidak
-- meninggalkan jejak di Nambah.
--
-- Satu order hanya boleh punya satu baris refund. Ini sengaja:
-- P2 hanya mendukung FULL refund, bukan partial refund. Kalau nanti butuh
-- partial, unique constraint ini diganti dengan constraint total amount.
-- ============================================================================

create table if not exists public.refunds (
  id bigint generated always as identity primary key,
  order_id text not null unique references public.orders(id) on delete cascade,
  provider text not null check (provider in ('midtrans', 'doku', 'paylabs', 'manual')),
  provider_refund_id text,
  amount bigint not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 2),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'failed', 'rejected')),
  requested_by_admin_user_id uuid,
  processed_by_admin_user_id uuid,
  provider_response jsonb,
  request_note text,
  completed_note text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists refunds_order_idx
  on public.refunds(order_id, status, requested_at desc);

create index if not exists refunds_status_idx
  on public.refunds(status, requested_at desc);

alter table public.refunds enable row level security;

revoke all on table public.refunds from anon, authenticated;
revoke usage, select on all sequences in schema public from anon, authenticated;

comment on table public.refunds is
  'Satu baris refund per order. P2 hanya mendukung full refund, sehingga '
  'order_id dibuat unique. Status processing dipakai sebagai claim CAS '
  'sebelum request refund dikirim ke gateway.';

comment on column public.refunds.provider_refund_id is
  'ID refund dari gateway (refund_key / referenceNo / platformTradeNo). '
  'Kosong kalau refund masih requested atau manual.';

comment on column public.refunds.status is
  'requested -> processing -> completed/failed. rejected dipakai kalau '
  'admin memutuskan tidak memproses refund setelah permintaan dibuat.';
