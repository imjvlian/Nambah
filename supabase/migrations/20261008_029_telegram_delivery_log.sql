-- 029: Antrean & jejak pengiriman Telegram, plus catatan digest harian.
--
-- Sebelum ini `sendTelegramMessage` hanya melempar error ke console: kalau
-- gagal, tidak ada yang tahu, dan tidak ada yang mencegah pengiriman ulang
-- ganda. Di VPS tidak ada log aggregator seperti Vercel, jadi jejaknya harus
-- ada di database.
--
-- `dedupe_key` unik adalah penahan spam: hook fulfilment/receipt bisa dipanggil
-- berkali-kali untuk order yang sama (webhook Digiflazz memang sering kirim
-- ulang), dan tanpa ini satu insiden bisa jadi puluhan pesan.
--
-- Isi `message_preview` dan `payload` adalah ringkasan operasional milik admin,
-- bukan data pelanggan.

create table if not exists public.telegram_delivery_log (
  id bigint generated always as identity primary key,
  -- Kategori pengiriman: "ops", "balance", "digest", "fulfillment", "receipt".
  kind text not null,
  -- "pending" (antrean worker), "sent", "failed", atau "skipped".
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  dedupe_key text not null unique,
  chat_id text,
  message_preview text,
  payload jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_delivery_log_pending_idx
  on public.telegram_delivery_log(created_at)
  where status = 'pending';

create index if not exists telegram_delivery_log_kind_idx
  on public.telegram_delivery_log(kind, created_at desc);

alter table public.telegram_delivery_log enable row level security;

-- Digest harian.
--
-- `digest_date` sebagai primary key membuat cron idempoten: kalau timer terpicu
-- dua kali atau worker di-restart di tengah jalan, tanggal yang sama tidak
-- terkirim ulang. `payload` disimpan supaya isi digest yang benar-benar terkirim
-- bisa dibaca ulang tanpa menghitung ulang dari database.

create table if not exists public.telegram_digest_runs (
  digest_date date primary key,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  message_preview text,
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telegram_digest_runs enable row level security;

-- Inbound Telegram: penanda `update_id` yang sudah dieksekusi.
--
-- Telegram mengirim ulang update yang belum dijawab dalam 24 jam, dan webhook
-- bisa dijadwal ulang saat deploy. Tanpa tabel ini, satu ketikan `/retry-receipt`
-- bisa menjalankan pengiriman receipt dua kali.
--
-- Datanya sengaja tidak diberi `updated_at` atau index lain: yang dibutuhkan
-- hanya pengecekan "sudah pernah?" dan satu baris per update.

create table if not exists public.telegram_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

alter table public.telegram_updates enable row level security;