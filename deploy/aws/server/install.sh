#!/bin/bash
# Prepares the server for a release. Runs as root on every deploy and is safe
# to repeat: it installs only what is missing and never overwrites data.
#
#   install.sh <ssm-config-parameter-name>
#
# Server layout:
#   /opt/sikkim/releases/<sha>   unpacked releases; /opt/sikkim/current -> live one
#   /var/lib/sikkim              separate EBS data disk (survives server replacement)
#     media/                     uploads (API user only)
#     secrets/secrets.env        generated once here; never leaves the server
#   /etc/sikkim/api.env          API environment, rebuilt from config + secrets
set -euo pipefail

CONFIG_PARAM=${1:?usage: install.sh <ssm-config-parameter-name>}
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source-path=SCRIPTDIR source=versions.env
. "$HERE/versions.env"
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/bin:/snap/bin:$PATH"

log() { printf '[install] %s\n' "$*"; }

cloud-init status --wait >/dev/null 2>&1 || true

# ---------- Packages ----------
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  log 'adding the Caddy package repository'
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
fi
packages=(ca-certificates curl jq xz-utils ffmpeg postgresql-client caddy)
missing=()
for p in "${packages[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [ ${#missing[@]} -gt 0 ]; then
  log "installing: ${missing[*]}"
  apt-get update -q
  apt-get install -y -q --no-install-recommends "${missing[@]}"
fi

# ---------- Node.js (pinned, checksum-verified) ----------
[ "$(uname -m)" = aarch64 ] || { echo 'This server setup expects arm64 (Graviton).' >&2; exit 1; }
if [ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  log "installing Node.js $NODE_VERSION"
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/node.tar.xz" \
    "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-arm64.tar.xz"
  echo "$NODE_SHA256_ARM64  $tmp/node.tar.xz" | sha256sum -c --quiet -
  mkdir -p "/opt/node-$NODE_VERSION"
  tar -xJf "$tmp/node.tar.xz" --strip-components=1 -C "/opt/node-$NODE_VERSION"
  rm -rf "$tmp"
  for bin in node npm npx; do ln -sfn "/opt/node-$NODE_VERSION/bin/$bin" "/usr/local/bin/$bin"; done
fi

# ---------- Settings from CloudFormation ----------
AWS_REGION=${AWS_REGION:-$(curl -fsS -H "X-aws-ec2-metadata-token: $(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)" http://169.254.169.254/latest/meta-data/placement/region)}
export AWS_REGION
config=$(aws ssm get-parameter --name "$CONFIG_PARAM" --query Parameter.Value --output text)
cfg() { jq -er ".$1" <<<"$config"; }
PUBLIC_ORIGIN=$(cfg publicOrigin)
DB_HOST=$(cfg dbHost)
DB_PORT=$(cfg dbPort)
DB_ADMIN_SECRET=$(cfg dbAdminSecretArn)
VPC_CIDR=$(cfg vpcCidr)
DATA_VOLUME=$(cfg dataVolumeId)

# ---------- Service user and data disk ----------
id sikkim >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/sikkim --no-create-home --shell /usr/sbin/nologin sikkim

device=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${DATA_VOLUME/-/}
for _ in $(seq 1 30); do [ -e "$device" ] && break; sleep 2; done
[ -e "$device" ] || { echo "Data disk $DATA_VOLUME is not attached." >&2; exit 1; }
if ! blkid "$device" >/dev/null 2>&1; then
  log 'formatting the new data disk'
  mkfs.ext4 -q -L sikkim-data "$device"
fi
grep -q '^LABEL=sikkim-data ' /etc/fstab ||
  echo 'LABEL=sikkim-data /var/lib/sikkim ext4 defaults,noatime,nofail 0 2' >>/etc/fstab
mkdir -p /var/lib/sikkim
mountpoint -q /var/lib/sikkim || mount /var/lib/sikkim

install -d -o root -g root -m 0755 /var/lib/sikkim /opt/sikkim /opt/sikkim/releases
install -d -o sikkim -g sikkim -m 0700 /var/lib/sikkim/media
install -d -o root -g root -m 0700 /var/lib/sikkim/secrets /etc/sikkim

# ---------- Secrets (created once, on this server only) ----------
secrets=/var/lib/sikkim/secrets/secrets.env
if [ ! -f "$secrets" ]; then
  log 'generating server secrets'
  (
    umask 077
    {
      echo "DB_OWNER_PASSWORD=$(openssl rand -hex 32)"
      echo "DB_APP_PASSWORD=$(openssl rand -hex 32)"
      echo "MEDIA_SIGNING_KEY=$(openssl rand -hex 32)"
      echo "OTP_SECRET=$(openssl rand -hex 32)"
    } >"$secrets.tmp"
    mv "$secrets.tmp" "$secrets"
  )
fi
# shellcheck disable=SC1090
. "$secrets"

# ---------- Database TLS trust (RDS CA bundle for this region) ----------
ca=/etc/sikkim/rds-ca.pem
if [ ! -s "$ca" ] || [ -n "$(find "$ca" -mtime +7)" ]; then
  curl -fsSLo "$ca.tmp" "https://truststore.pki.rds.amazonaws.com/$AWS_REGION/$AWS_REGION-bundle.pem"
  grep -q 'BEGIN CERTIFICATE' "$ca.tmp"
  chmod 0644 "$ca.tmp" && mv "$ca.tmp" "$ca"
fi
chmod 0755 /etc/sikkim

# ---------- Database roles (first run, or after the database moves) ----------
db_marker=/var/lib/sikkim/secrets/database-ready
if [ "$(cat "$db_marker" 2>/dev/null || true)" != "$DB_HOST" ]; then
  log 'preparing database roles'
  admin=$(aws secretsmanager get-secret-value --secret-id "$DB_ADMIN_SECRET" --query SecretString --output text)
  PGUSER=$(jq -er .username <<<"$admin") PGPASSWORD=$(jq -er .password <<<"$admin") \
    PGHOST=$DB_HOST PGPORT=$DB_PORT PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT=$ca \
    psql -X -q -v ON_ERROR_STOP=1 <<SQL
\set owner_password '$DB_OWNER_PASSWORD'
\set app_password '$DB_APP_PASSWORD'
SELECT 'CREATE ROLE sikkim_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sikkim_owner')\gexec
SELECT 'CREATE ROLE sikkim_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sikkim_app')\gexec
ALTER ROLE sikkim_owner PASSWORD :'owner_password';
ALTER ROLE sikkim_app PASSWORD :'app_password';
GRANT sikkim_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SELECT 'CREATE DATABASE sikkim OWNER sikkim_owner'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sikkim')\gexec
SET ROLE sikkim_owner;
REVOKE ALL ON DATABASE sikkim FROM PUBLIC;
GRANT CONNECT ON DATABASE sikkim TO sikkim_app;
\connect sikkim
SET ROLE sikkim_owner;
ALTER SCHEMA public OWNER TO sikkim_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
  echo "$DB_HOST" >"$db_marker"
fi

# ---------- API environment ----------
db_url() { printf 'postgresql://%s:%s@%s:%s/sikkim' "$1" "$2" "$DB_HOST" "$DB_PORT"; }
(
  umask 077
  cat >/etc/sikkim/api.env.tmp <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_API_ORIGIN=$PUBLIC_ORIGIN
FRONTEND_ORIGINS=$PUBLIC_ORIGIN
DATABASE_URL=$(db_url sikkim_app "$DB_APP_PASSWORD")
MIGRATION_DATABASE_URL=$(db_url sikkim_owner "$DB_OWNER_PASSWORD")
DB_TLS=true
DB_CA_FILE=$ca
TRUST_PROXY_CIDRS=127.0.0.1/32
MEDIA_STORAGE_MODE=single_server
MEDIA_STORAGE_DIR=/var/lib/sikkim/media
MEDIA_SIGNING_KEY=$MEDIA_SIGNING_KEY
HOST_VERIFICATION_MODE=manual
OTP_DELIVERY=disabled
OTP_SECRET=$OTP_SECRET
AI_PROVIDER=disabled
ENABLE_DEMO_AUTH=false
REQUESTS_PER_MINUTE=600
ENV
  # Hand-made overrides (for example AI_PROVIDER and ANTHROPIC_API_KEY) win.
  [ -f /etc/sikkim/overrides.env ] && cat /etc/sikkim/overrides.env >>/etc/sikkim/api.env.tmp
  mv /etc/sikkim/api.env.tmp /etc/sikkim/api.env
)

# ---------- Services ----------
install -m 0644 "$HERE/sikkim-api.service" /etc/systemd/system/sikkim-api.service
install -m 0755 "$HERE/sikkim-admin" /usr/local/sbin/sikkim-admin
systemctl daemon-reload
systemctl enable sikkim-api >/dev/null 2>&1

# Caddy trusts X-Forwarded-For only from CloudFront's origin-facing addresses
# (the security group admits nothing else) and passes the viewer IP to the API.
cf_ranges=$(curl -fsS https://ip-ranges.amazonaws.com/ip-ranges.json |
  jq -r '[.prefixes[] | select(.service == "CLOUDFRONT_ORIGIN_FACING") | .ip_prefix] | join(" ")')
[ -n "$cf_ranges" ] || { echo 'Could not read CloudFront address ranges.' >&2; exit 1; }
cat >/etc/caddy/Caddyfile.new <<CADDY
{
	servers {
		trusted_proxies static $VPC_CIDR $cf_ranges
		trusted_proxies_strict
		client_ip_headers X-Forwarded-For
	}
}

:80 {
	encode zstd gzip
	header -Server

	handle /v1/* {
		reverse_proxy 127.0.0.1:3000 {
			header_up X-Forwarded-For {client_ip}
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		root * /opt/sikkim/current/frontend
		header X-Content-Type-Options nosniff
		header Referrer-Policy strict-origin-when-cross-origin
		header Strict-Transport-Security "max-age=31536000"
		@hashed path /assets/*
		header @hashed Cache-Control "public, max-age=31536000, immutable"
		@other not path /assets/*
		header @other Cache-Control no-cache
		try_files {path} /index.html
		file_server
	}
}
CADDY
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile.new >/dev/null
if ! cmp -s /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile; then
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  systemctl reload-or-restart caddy
  log 'Caddy configuration updated'
else
  rm /etc/caddy/Caddyfile.new
fi
systemctl enable --now caddy >/dev/null 2>&1
log 'server ready'
