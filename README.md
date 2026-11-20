# Sikkim Experiences backend

Node 24 · TypeScript · Fastify 5 · PostgreSQL. The API behind the [Sikkim Experiences app](https://github.com/gauravyad86/sikkim-experiences): accounts, hosts, experiences, free bookings with QR tickets, media, Community, and an admin workspace with a curator CRM.

- [Architecture and workflow diagrams](docs/ARCHITECTURE.md)
- [API guide](docs/API.md)
- [Current team demo server](docs/DEPLOYMENT.md)

## What works

| Area      | Status                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Accounts  | Email + password sign-up and sign-in, 30-minute sessions refreshed up to 24 h, privacy export and deletion request                  |
| Discovery | Catalogue, filters, search, reviews, saves and likes                                                                                |
| Bookings  | Free bookings: slots, 10-minute seat holds, bookings, QR tickets, host check-in, cancel and reschedule                              |
| Hosts     | Profiles; real hosts approved after a manual identity check (`HOST_VERIFICATION_MODE=manual`)                                       |
| Media     | Uploads checked and converted with ffmpeg, rights metadata, admin review, signed links                                              |
| Community | Events and event photos                                                                                                             |
| Admin     | Operations overview, curator CRM pipeline with notes, user search and suspension, booking lookup, operator command for admin access |
| Not yet   | Paid checkout, email verification and password reset, Community chat, object storage for media                                      |

## Requirements

- Node 24 (`.nvmrc`). On macOS with a newer default Node: `brew install node@24` and put `/opt/homebrew/opt/node@24/bin` first on `PATH`.
- PostgreSQL 16+ with `psql` on your `PATH`.
- ffmpeg **with the libwebp and libx264 encoders**. Homebrew's plain `ffmpeg` lacks WebP; use `brew install ffmpeg-full` and put `/opt/homebrew/opt/ffmpeg-full/bin` first on `PATH`. Ubuntu's `ffmpeg` package works as is.

## Run locally

```sh
npm ci
cp .env.example .env          # then fill in passwords and keys
npm run db:setup              # once: creates roles + sikkim_dev and sikkim_test
npm run build
npm run db:migrate
npm run db:seed
npm run dev                   # http://127.0.0.1:3000/v1/health/ready
```

Optional local sample content (needs `ENABLE_DEMO_AUTH=true` and media settings):

```sh
npm run db:preview
npm run db:media-preview -- --from=../sikkim-experiences/public/videos
```

### Make yourself an admin

Register in the app first, then on the machine that runs the API:

```sh
npm run build
npm run admin -- grant --email=you@example.com
npm run admin -- list
npm run admin -- revoke --email=someone@example.com
```

The command uses `MIGRATION_DATABASE_URL` (owner credentials). The API's own database role cannot change roles, so admin access can never be granted through a compromised API.

## Configuration

All settings come from the environment (`.env` locally, a private env file on servers). Never commit `.env` files.

| Variable                                                                           | Required           | Purpose                                                                       |
| ---------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `NODE_ENV`                                                                         | yes                | `development`, `test` or `production`                                         |
| `HOST`, `PORT`                                                                     | no                 | Bind address (IP only) and port; default `127.0.0.1:3000`                     |
| `FRONTEND_ORIGINS`                                                                 | yes                | Comma-separated exact origins allowed by CORS (HTTPS in production)           |
| `PUBLIC_API_ORIGIN`                                                                | production         | Public HTTPS origin of the API                                                |
| `DATABASE_URL`                                                                     | yes                | Runtime connection as the least-privilege app role                            |
| `MIGRATION_DATABASE_URL`                                                           | for migrations/CLI | Owner connection, same host and database                                      |
| `DB_TLS`, `DB_CA_FILE`                                                             | production         | Verified TLS to PostgreSQL (`DB_TLS=true` required in production)             |
| `TRUST_PROXY_CIDRS`                                                                | behind a proxy     | Exact proxy IPs/CIDRs whose forwarded headers are trusted                     |
| `REQUESTS_PER_MINUTE`                                                              | no                 | General rate limit per IP (default 100); login and upload limits are stricter |
| `HOST_VERIFICATION_MODE`                                                           | no                 | `disabled` (default) or `manual` to let admins approve real hosts             |
| `MEDIA_STORAGE_MODE`                                                               | no                 | `local` (default) or `single_server` for one production server                |
| `MEDIA_STORAGE_DIR`, `MEDIA_SIGNING_KEY`                                           | for media          | Private absolute directory and a 32+ character signing key                    |
| `ENABLE_DEMO_AUTH`                                                                 | local only         | Test sign-in accounts; refused in production                                  |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` | setup only         | Used by `npm run db:setup`                                                    |

Startup fails with a clear message if a value is unsafe or missing.

## Checks

```sh
cp .env.test.example .env.test   # match the passwords from .env
npm run check                    # format, typecheck, unit tests, build
npm run test:integration         # resets sikkim_test
```

CI runs the same steps plus `npm audit` and secret scanning on every push and pull request.

## Project layout

```
src/
  app.ts            Fastify setup, security plugins, error handling, health
  config.ts         Environment parsing and validation
  server.ts         Process entry point
  accounts/         Sign-up, sessions, profile, privacy
  hosts/            Host profiles and identity review
  catalogue/        Experiences, search, reviews, admin publishing
  bookings/         Slots, holds, bookings, tickets, check-in
  media/            Uploads, processing, delivery, reels and stories
  community/        Events and photos
  admin/            Overview metrics, curator CRM, users, booking lookup
  db/               Pool, migrations runner, audit helper, local seeds
  bin/              CLI entry points (database, media preview, admin)
migrations/         Ordered SQL migrations (node-pg-migrate)
test/unit/          Fast tests without a database
test/integration/   Tests against the disposable sikkim_test database
```

## Changelog

- **2026-11-20** Admin workspace API and curator CRM (`crm_leads`, `crm_lead_notes`), manual identity verification for real hosts (`HOST_VERIFICATION_MODE`), `npm run admin` operator command, architecture diagrams.

[Remaining work](https://github.com/gauravyad86/sikkim-experiences-backend/issues)
