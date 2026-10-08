# Cron Nambah di VPS (systemd timer)

Dokumen ini menggantikan bagian "Vercel Cron" di `PRODUCTION.md`. Di VPS,
`vercel.json` tidak dibaca siapa pun — jadwal hanya berjalan kalau ada timer
systemd yang memanggilnya.

## Kenapa tidak pakai vercel.json

`vercel.json` mendaftarkan tiga cron, semuanya `0 3 * * *`, dengan alasan batas
plan Hobby Vercel. Di VPS file itu tidak berefek apa pun. Kalau tidak ada timer,
endpoint di `/api/cron/*` hanya berjalan saat dipanggil manual.

## Isi folder

| File | Fungsi |
| --- | --- |
| `nambah-cron@.service` | Unit template: memanggil satu endpoint cron |
| `nambah-cron@.timer` | Unit template: perilaku timer (persistent, jitter) |
| `install-timers.sh` | Memasang semua timer beserta jadwalnya |
| `nambah-cron-run.sh` | Pemanggilan satu job, juga untuk tes manual |

## Instalasi

`APP_DIR` adalah lokasi repo. Repo di `/opt/nambah` bisa memakai nilai default;
repo di mana saja harus diberi eksplisit, karena unit systemd memakai absolute
path untuk `ExecStart`.

```bash
export APP_DIR=/home/ubuntu/Nambah   # sesuaikan

# 1. Buat file env cron.
sudo mkdir -p /etc/nambah
sudo install -m 0600 /dev/null /etc/nambah/cron.env
sudoedit /etc/nambah/cron.env
```

Isi `/etc/nambah/cron.env`:

```env
CRON_SECRET=<secret panjang, sama dengan CRON_SECRET di .env aplikasi>
CRON_BASE_URL=http://127.0.0.1:3000
```

`CRON_BASE_URL` memakai `127.0.0.1` supaya request tidak keluar ke internet dan
tidak melewati TLS. Kalau aplikasinya sudah punya nama host lokal, pakai itu.

`CRON_SECRET` di sini **harus sama** dengan `CRON_SECRET` di environment
aplikasi. Kalau beda, semua job membalas 401 dan tidak ada yang memberi tahu
selain kode HTTP di journal. Bandingkan tanpa mencetak rahasianya:

```bash
sudo grep CRON_SECRET /etc/nambah/cron.env | md5sum
grep CRON_SECRET "$APP_DIR/.env.local" | md5sum
```

Kedua hash harus sama.

```bash
# 2. Pasang timer
sudo APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/systemd/install-timers.sh"

# 3. Cek
systemctl list-timers 'nambah-cron@*'
```

Kalau `APP_DIR` tidak diteruskan, unit akan terpasang dengan `ExecStart` ke
`/opt/nambah/...` dan setiap job gagal `203/EXEC`. Script memverifikasi ini
sendiri dan berhenti dengan pesan error kalau `ExecStart`-nya tidak sesuai.

> **Catatan `ProtectHome`.** Unit memakai `ProtectHome=read-only`, bukan
> `true`, supaya repo yang berada di direktori home masih bisa dibaca. Repo di
> `/opt` tidak terpengaruh.

## Jadwal yang dipasang

| Job | Jadwal UTC | Setara cron |
| --- | --- | --- |
| `reconcile` | setiap 5 menit | `*/5 * * * *` |
| `operations-health` | setiap 10 menit | `*/10 * * * *` |
| `digiflazz-balance` | setiap 15 menit | `*/15 * * * *` |
| `financial-reconcile` | setiap jam, menit 7 | `7 * * * *` |
| `points-expiry` | 00:30 setiap hari | `30 0 * * *` |
| `telegram-dispatch` | setiap menit | `* * * * *` |
| `daily-digest` | 01:00 setiap hari (08:00 WIB) | `1 0 * * *` |

Semua jadwal ditulis eksplisit dengan sufiks `UTC`, jadi tidak ikut berubah kalau
timezone server diganti. `financial-reconcile` sengaja tidak di menit 0 supaya
tidak menumpuk dengan cron lain.

## Tes manual

```bash
"$APP_DIR/deploy/systemd/nambah-cron-run.sh" reconcile
"$APP_DIR/deploy/systemd/nambah-cron-run.sh" operations-health
"$APP_DIR/deploy/systemd/nambah-cron-run.sh" telegram-dispatch

# Digest untuk tanggal tertentu. Tanpa `force`, tanggal yang sudah pernah
# terkirim akan dilewati.
"$APP_DIR/deploy/systemd/nambah-cron-run.sh" daily-digest date=2026-10-07
```

Exit code 0 kalau HTTP 2xx. Non-zero kalau gagal — itulah yang dibaca systemd
sebagai failure, dan muncul di `journalctl -u nambah-cron@<job>`.

## Kalau job tidak jalan

`Persistent=true` membuat job yang terlewat saat server mati tetap jalan saat
boot, tapi hanya sekali. Kalau sistemnya sering mati, tetap periksa
`systemctl list-timers` untuk melihat `LAST` dan `MISSED`.

Untuk melihat log:

```bash
journalctl -u nambah-cron@reconcile -n 50 --no-pager
journalctl -u 'nambah-cron@*' --since today --no-pager
```

## Jika timer tidak muncul di `list-timers`

`systemctl list-timers 'nambah-cron@*'` hanya menampilkan timer yang **aktif**.
Kalau kosong, tambahkan `--all` untuk melihat yang termuat tapi tidak aktif:

```bash
systemctl list-timers 'nambah-cron@*' --all --no-pager
systemctl is-enabled nambah-cron@reconcile.timer
systemctl cat nambah-cron@reconcile.service | grep ExecStart
```

Kalau `ExecStart` menunjuk ke `/opt/nambah` padahal repo Anda di direktori
lain, ulangi `./install-timers.sh` dengan `APP_DIR` yang benar — unit akan
di-render ulang.

## Telegram

Butuh dua variabel tambahan di environment aplikasi (bukan di `cron.env`):

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
```

`TELEGRAM_WEBHOOK_SECRET` hanya dipakai kalau bot dua arah diaktifkan. Pasang
webhook-nya sekali:

```bash
node scripts/telegram-set-webhook.mjs --info     # cek dulu
node scripts/telegram-set-webhook.mjs            # pasang
```

Kalau `TELEGRAM_WEBHOOK_SECRET` tidak diisi, endpoint `/api/telegram/webhook`
menolak semua request dengan 503 — disengaja, supaya bot tidak bisa disuruh
oleh siapa pun. Perintah keluar (alert, digest) tetap jalan tanpa secret itu.