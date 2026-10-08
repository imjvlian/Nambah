#!/usr/bin/env bash
# Pasang semua timer cron Nambah.
#
# Setiap job punya jadwal sendiri, jadi jadwalnya ditulis sebagai drop-in di
# /etc/systemd/system/nambah-cron@<job>.timer.d/override.conf. Template timer
# hanya memberi perilaku umum (Persistent, random delay, unit yang dipanggil).
#
#   sudo APP_DIR=/home/ubuntu/Nambah bash deploy/systemd/install-timers.sh
#   sudo APP_DIR=/home/ubuntu/Nambah bash deploy/systemd/install-timers.sh --dry-run
#
# `APP_DIR` default ke /opt/nambah. Kalau repo ada di lokasi lain, WAJIB
# meneruskan APP_DIR: unit systemd memakai absolute path untuk ExecStart, jadi
# path yang salah membuat setiap job gagal 203/EXEC.
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

RUN_SCRIPT="${APP_DIR}/deploy/systemd/nambah-cron-run.sh"

if [[ ! -f "$RUN_SCRIPT" ]]; then
  echo "ERROR: $RUN_SCRIPT tidak ditemukan." >&2
  echo "       Jalankan dari dalam repo, atau set APP_DIR ke lokasi repo." >&2
  exit 1
fi

echo "APP_DIR: $APP_DIR"
echo "ExecStart: $RUN_SCRIPT"
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

# Bit executable hilang setiap `git pull` kalau git tidak mencatat mode 100755
# (git hanya melacak executable bit, bukan permission lengkap).
chmod +x "$RUN_SCRIPT"

# Unit `.service` di-render ulang, bukan disalin apa adanya: `ExecStart` harus
# mengikuti lokasi repo. Repo di /opt/nambah menghasilkan unit yang sama dengan
# template; repo di direktori home menghasilkan unit yang benar.
sed "s|^ExecStart=.*|ExecStart=$RUN_SCRIPT %i|" \
  "$UNIT_DIR/nambah-cron@.service" \
  | sed "s|^Documentation=.*|Documentation=file://$UNIT_DIR/README.md|" \
  > /etc/systemd/system/nambah-cron@.service
chmod 0644 /etc/systemd/system/nambah-cron@.service

install -m 0644 "$UNIT_DIR/nambah-cron@.timer" /etc/systemd/system/nambah-cron@.timer

if ! grep -q "^ExecStart=$RUN_SCRIPT %i$" /etc/systemd/system/nambah-cron@.service; then
  echo "ERROR: ExecStart di unit terpasang tidak sesuai APP_DIR." >&2
  echo " harus: $RUN_SCRIPT %i" >&2
  echo " punya: $(grep '^ExecStart=' /etc/systemd/system/nambah-cron@.service)" >&2
  exit 1
fi

systemctl daemon-reload

echo ""
ENABLED=0
FAILED=0
while IFS='|' read -r job _schedule _cron _description; do
  [[ -z "$job" ]] && continue
  if systemctl enable --now "nambah-cron@${job}.timer" >/dev/null 2>&1; then
    echo "  aktif : nambah-cron@${job}.timer"
    ENABLED=$((ENABLED + 1))
  else
    echo "  GAGAL : nambah-cron@${job}.timer"
    FAILED=$((FAILED + 1))
  fi
done <<< "$JOBS"

echo ""
echo "Jadwal terpasang:"
systemctl list-timers 'nambah-cron@*' --no-pager

# Verifikasi: `list-timers` tanpa `--all` hanya menampilkan timer yang aktif.
# Kalau kosong berarti tidak ada satu pun yang hidup, dan itu harus keluar
# sebagai kegagalan, bukan "sukses" yang diam-diam.
ACTIVE=$(systemctl list-timers 'nambah-cron@*' --no-legend --no-pager 2>/dev/null | grep -c 'nambah-cron@' || true)
if [[ "${ACTIVE:-0}" -eq 0 ]]; then
  echo ""
  echo "GAGAL: tidak ada timer yang aktif setelah pemasangan." >&2
  echo "Cek manual: systemctl daemon-reload && systemctl enable --now nambah-cron@reconcile.timer" >&2
  exit 1
fi

echo ""
echo "Aktif: $ENABLED, gagal: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  echo ""
  echo "GAGAL: $FAILED timer tidak bisa diaktifkan." >&2
  echo "Cek: systemctl status nambah-cron@<job>.timer" >&2
  exit 1
fi

echo "Lanjutkan: tes satu job sebelum menunggu timer:"
echo "  $RUN_SCRIPT reconcile"
echo "  journalctl -u nambah-cron@reconcile -n 20 --no-pager"