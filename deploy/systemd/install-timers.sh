#!/usr/bin/env bash
# Pasang semua timer cron Nambah.
#
# Setiap job punya jadwal sendiri, jadi jadwalnya ditulis sebagai drop-in di
# /etc/systemd/system/nambah-cron@<job>.timer.d/override.conf. Template timer
# hanya memberi perilaku umum (Persistent, random delay, unit yang dipanggil).
#
#   sudo deploy/systemd/install-timers.sh
#   sudo deploy/systemd/install-timers.sh --dry-run
#
# Jalankan ulang setiap kali daftar job atau jadwal berubah.

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

APP_DIR="${APP_DIR:-/opt/nambah}"
UNIT_DIR="${APP_DIR}/deploy/systemd"

# Format: job | OnCalendar systemd | cron equivalents | keterangan
#
# Semua jadwal ditulis eksplisit dalam UTC supaya tidak bergantung pada
# timezone server. 01:00 UTC = 08:00 WIB.
read -r -d '' JOBS <<'EOF' || true
reconcile|*-*-* *:0/5:00 UTC|*/5 * * * *|Sweep order kedaluwarsa, retry supplier & receipt
operations-health|*-*-* *:0/10:00 UTC|*/10 * * * *|Alert incident + order nyangkut
digiflazz-balance|*-*-* *:0/15:00 UTC|*/15 * * * *|Alert saldo Digiflazz
financial-reconcile|*-*-* *:07:00:00 UTC|7 * * * *|Rekonsiliasi keuangan
points-expiry|*-*-* 00:30:00 UTC|30 0 * * *|Expiry poin
telegram-dispatch|*-*-* *:*:0/1:00 UTC|* * * * *|Drain antrean notifikasi Telegram
daily-digest|*-*-* 01:00:00 UTC|1 0 * * *|Digest harian (08:00 WIB)
EOF

echo "APP_DIR: $APP_DIR"
echo ""

while IFS='|' read -r job schedule cron_equiv description; do
  [[ -z "$job" ]] && continue
  printf '%-20s %-24s [%s]\n' "$job" "$schedule" "$description"

  [[ $DRY_RUN -eq 1 ]] && continue

  install -d -m 0755 "/etc/systemd/system/nambah-cron@${job}.timer.d"
  cat > "/etc/systemd/system/nambah-cron@${job}.timer.d/override.conf" <<EOF
# Dijalankan oleh install-timers.sh.
# Jadwal cron setara: $cron_equiv
# $description
[Timer]
OnCalendar=$schedule
EOF
done <<< "$JOBS"

if [[ $DRY_RUN -eq 1 ]]; then
  echo ""
  echo "--dry-run: tidak ada yang diubah."
  exit 0
fi

echo ""
echo "Memasang unit..."
install -m 0644 "$UNIT_DIR/nambah-cron@.service" /etc/systemd/system/nambah-cron@.service
install -m 0644 "$UNIT_DIR/nambah-cron@.timer" /etc/systemd/system/nambah-cron@.timer
install -m 0755 "$UNIT_DIR/nambah-cron-run.sh" "$APP_DIR/deploy/systemd/nambah-cron-run.sh"

systemctl daemon-reload

echo ""
while IFS='|' read -r job _schedule _cron _description; do
  [[ -z "$job" ]] && continue
  if systemctl enable --now "nambah-cron@${job}.timer" >/dev/null 2>&1; then
    echo "  aktif : nambah-cron@${job}.timer"
  else
    echo "  GAGAL : nambah-cron@${job}.timer"
  fi
done <<< "$JOBS"

echo ""
echo "Jadwal terpasang:"
systemctl list-timers 'nambah-cron@*' --no-pager
echo ""
echo "Lanjutkan: pastikan /etc/nambah/cron.env ada, lalu tes satu job:"
echo "  sudo -u nambah $APP_DIR/deploy/systemd/nambah-cron-run.sh reconcile"