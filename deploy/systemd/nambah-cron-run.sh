#!/usr/bin/env bash
# Panggil satu endpoint cron Nambah dengan CRON_SECRET.
#
# Dipakai oleh nambah-cron@.service, dan bisa dipanggil langsung saat tes:
#   deploy/systemd/nambah-cron-run.sh reconcile
#   deploy/systemd/nambah-cron-run.sh daily-digest date=2026-10-07
#   deploy/systemd/nambah-cron-run.sh daily-digest date=2026-10-07 force=1
#
# Environment dibaca dari /etc/nambah/cron.env (lihat README di folder ini).

set -euo pipefail

JOB="${1:-}"
if [[ -z "$JOB" ]]; then
  echo "Pakai: $0 <nama-job> [key=value ...]" >&2
  echo "Job yang tersedia:" >&2
  echo "  reconcile, operations-health, digiflazz-balance," >&2
  echo "  financial-reconcile, points-expiry, telegram-dispatch, daily-digest" >&2
  exit 64
fi
shift

ENV_FILE="${NAMBAH_CRON_ENV:-/etc/nambah/cron.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Normalisasi nilai dari file env sebelum dipakai.
#
# File env sering lahir dari `grep` terhadap `.env.local` yang disunting di
# Windows atau diedit dengan editor ber-CRLF. `source` tidak membuang `\r`, jadi
# nilainya jadi `rahasia\r`, dan Node menolak request itu dengan
# `400 Bad Request`, `Connection: close`, tanpa body dan tanpa satu pun header
# Next.js — gejalanya sama sekali tidak mengarah ke penyebabnya.
#
# `${VAR:-}` dipakai lebih dulu supaya tidak memicu "unbound variable" dari
# `set -u` kalau env file tidak ada sama sekali.
CRON_SECRET="${CRON_SECRET:-}"
CRON_BASE_URL="${CRON_BASE_URL:-}"

CRON_SECRET="${CRON_SECRET//$'\r'/}"
CRON_BASE_URL="${CRON_BASE_URL//$'\r'/}"

: "${CRON_SECRET:?CRON_SECRET belum diisi di $ENV_FILE}"

# Setelah CR dibuang, sisa karakter kontrol berarti file env rusak atau
# tersalin dari tempat yang salah. Header HTTP tidak boleh memuatnya, dan
# gejalanya lagi-lagi 400 tanpa body — jadi tolak lebih awal dengan pesan yang
# jelas, sebelum request-nya dikirim.
if [[ "$CRON_SECRET" =~ [[:cntrl:]] ]]; then
  echo "CRON_SECRET mengandung karakter kontrol — periksa $ENV_FILE" >&2
  exit 78
fi

BASE_URL="${CRON_BASE_URL:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"
URL="$BASE_URL/api/cron/$JOB"

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

# Argumen jadi query string, jadi `date=2026-10-07` aman dari karakter yang
# harus di-encode.
QUERY_ARGS=()
for pair in "$@"; do
  QUERY_ARGS+=(--data-urlencode "$pair")
done

START=$(date +%s)
# `|| true` dipakai, bukan `|| echo 000`: kalau curl gagal setelah sempat
# menulis `--write-out`, hasilnya bisa jadi "000000" dan tidak cocok dengan
# pola case di bawah.
HTTP_CODE="$(curl --silent --show-error --max-time 300 --get \
  "${QUERY_ARGS[@]+"${QUERY_ARGS[@]}"}" \
  --output "$BODY_FILE" \
  --write-out '%{http_code}' \
  --header "Authorization: Bearer $CRON_SECRET" \
  "$URL" || true)"
HTTP_CODE="${HTTP_CODE:-000}"

DURATION=$(( $(date +%s) - START ))
echo "[$JOB] http=$HTTP_CODE durasi=${DURATION}s"
head -c 600 "$BODY_FILE" 2>/dev/null || true
echo

# systemd membaca exit code. 2xx sukses; sisanya failure supaya
# `systemctl status` dan journal menandai job-nya bermasalah.
#
# Exit code memakai kelas EX_* dari sysexits(3) supaya kegagalan bisa dibedakan
# tanpa membaca isi pesannya: 69 = layanan menolak (4xx/5xx), 75 = tempfail
# (koneksi gagal, timeout, 429).
case "$HTTP_CODE" in
  2*) exit 0 ;;
  000) echo "Tidak ada respons dari $URL — cek CRON_BASE_URL dan aplikasi." >&2; exit 75 ;;
  4[0-4]*|4[9]*) exit 69 ;;
  429) exit 75 ;;
  5*) exit 69 ;;
  *) exit 1 ;;
esac