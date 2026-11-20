#!/bin/sh
set -eu
# One-time setup on a local PostgreSQL installation; never changes existing names.
case "${NODE_ENV:-}" in
  development|test) ;;
  *) echo "Local setup requires NODE_ENV=development or test." >&2; exit 1 ;;
esac
case "${PGHOST:-127.0.0.1}" in
  localhost|127.0.0.1|::1) ;;
  *) echo "Local setup only accepts a localhost PostgreSQL server." >&2; exit 1 ;;
esac
: "${DB_OWNER_PASSWORD:?Set DB_OWNER_PASSWORD in .env}"
: "${DB_APP_PASSWORD:?Set DB_APP_PASSWORD in .env}"
# Do not let a libpq service or address override the checked local host.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
psql -X -v ON_ERROR_STOP=1 --dbname postgres \
  --set=owner_password="$DB_OWNER_PASSWORD" --set=app_password="$DB_APP_PASSWORD" <<'SQL'
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Run setup with your local PostgreSQL administrator (PGUSER).';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('sikkim_owner', 'sikkim_app'))
     OR EXISTS (SELECT FROM pg_database WHERE datname IN ('sikkim_dev', 'sikkim_test')) THEN
    RAISE EXCEPTION 'Project roles or databases already exist. Setup stopped without changing them; use their existing connection settings.';
  END IF;
END $$;
CREATE ROLE sikkim_owner LOGIN PASSWORD :'owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE sikkim_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
COMMIT;
CREATE DATABASE sikkim_dev OWNER sikkim_owner;
CREATE DATABASE sikkim_test OWNER sikkim_owner;
COMMENT ON DATABASE sikkim_dev IS 'sikkim-local-only';
COMMENT ON DATABASE sikkim_test IS 'sikkim-local-only';
REVOKE ALL ON DATABASE sikkim_dev FROM PUBLIC;
REVOKE ALL ON DATABASE sikkim_test FROM PUBLIC;
GRANT CONNECT ON DATABASE sikkim_dev, sikkim_test TO sikkim_app;
\connect sikkim_dev
ALTER SCHEMA public OWNER TO sikkim_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect sikkim_test
ALTER SCHEMA public OWNER TO sikkim_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
