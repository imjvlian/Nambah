-- Nambah 0.4.0 — per-order opaque access tokens.
-- Raw tokens are never stored in the database; only SHA-256 hashes are persisted.

alter table public.orders
  add column if not exists access_token_hash text;

comment on column public.orders.access_token_hash is
  'SHA-256 hash of the opaque order access token. Raw token is returned once to the browser.';
