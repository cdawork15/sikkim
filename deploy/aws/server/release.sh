#!/bin/bash
# Makes an unpacked release live. Runs as root after install.sh.
#
#   release.sh /opt/sikkim/releases/<sha>
#
# Order: install production dependencies -> run database migrations -> switch
# /opt/sikkim/current -> restart the API -> health check. If the new API does
# not become ready, the previous release is put back. Migrations are not rolled
# back, so keep them backward compatible (RDS point-in-time backups: see DbBackupDays in stack.yaml).
set -euo pipefail
REL=${1:?usage: release.sh <release-dir>}
REL=$(cd "$REL" && pwd)
export PATH="/usr/local/bin:/snap/bin:$PATH"
log() { printf '[release] %s\n' "$*"; }

as_api() {
  systemd-run --quiet --wait --pipe --collect --uid=sikkim --gid=sikkim \
    -p EnvironmentFile=/etc/sikkim/api.env -p WorkingDirectory="$1" "${@:2}"
}

ready() {
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/v1/health/ready &&
      curl -fsS -o /dev/null http://127.0.0.1/v1/health/ready &&
      curl -fsS -o /dev/null http://127.0.0.1/; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log "installing backend dependencies for $(basename "$REL")"
(cd "$REL/backend" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  --cache /var/cache/sikkim-npm --loglevel=error)
chown -R root:root "$REL"
chmod -R u=rwX,go=rX "$REL"

log 'running database migrations'
as_api "$REL/backend" /usr/local/bin/node dist/bin/database.js migrate

previous=$(readlink -f /opt/sikkim/current 2>/dev/null || true)
ln -sfn "$REL" /opt/sikkim/current.new
mv -T /opt/sikkim/current.new /opt/sikkim/current
systemctl restart sikkim-api

if ready; then
  log "live: $(basename "$REL")"
else
  echo 'The new release did not become ready. Recent API log:' >&2
  journalctl -u sikkim-api -n 40 --no-pager >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$REL" ] && [ -d "$previous" ]; then
    echo "Rolling back to $(basename "$previous")." >&2
    ln -sfn "$previous" /opt/sikkim/current.new
    mv -T /opt/sikkim/current.new /opt/sikkim/current
    systemctl restart sikkim-api
  fi
  exit 1
fi

# Keep the live release and the three newest others.
live=$(readlink -f /opt/sikkim/current)
find /opt/sikkim/releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
  sort -rn | awk 'NR > 4 { print $2 }' | while read -r old; do
  [ "$old" = "$live" ] || rm -rf "$old"
done
