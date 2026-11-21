# Sikkim Experiences

A mobile-first web app for discovering and booking local experiences in Sikkim: reels, trips run by local hosts, free bookings with QR tickets, Community events, and an Operations workspace with a curator CRM.

| Folder                  | What it is                                | Stack                                  | Deploys as                                           |
| ----------------------- | ----------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| [`frontend/`](frontend) | Web app for travellers, hosts and staff   | React 19, TypeScript, Vite             | Static files (`dist/`) with an `index.html` fallback |
| [`backend/`](backend)   | API under `/v1`                           | Node 24, Fastify 5, PostgreSQL, ffmpeg | Node service behind HTTPS, proxied at `/v1`          |
| [`docs/`](docs)         | System architecture and workflow diagrams | Mermaid                                | —                                                    |

- [Architecture and workflows](docs/ARCHITECTURE.md)
- [Backend setup, configuration and staff access](backend/README.md) · [API guide](backend/docs/API.md)
- [Frontend screens and configuration](frontend/README.md) · [Design rules](frontend/docs/DEMO.md) · [Prototype screens](frontend/docs/design-references/)

## Run everything locally

Requirements: Node 24 (`.nvmrc`), PostgreSQL 16+ with `psql`, and ffmpeg with WebP and x264 support (on macOS: `brew install node@24 ffmpeg-full`). Details are in each folder's README.

```sh
# 1. API (terminal 1)
cd backend
npm ci
cp .env.example .env          # fill in passwords and secrets
npm run db:setup              # once
npm run build && npm run db:migrate && npm run db:seed
npm run dev                   # http://127.0.0.1:3000/v1/health/ready

# 2. Web app (terminal 2)
cd frontend
npm ci
npm run dev                   # http://127.0.0.1:5173
```

Sign in at `/welcome` with a one-time code, or with a password once you have added one (Profile → Password & sign-in; mobile number or email). Locally the API prints codes in its log (`"event":"otp_dev_code"`). Set a staff password from the server with `npm run admin -- set-password --email=…`. Give staff access with `npm run admin -- grant --email=… --role=admin|super` in `backend/`.

## Account types

| Type  | Can do                                                                         |
| ----- | ------------------------------------------------------------------------------ |
| User  | Browse, book, save, share reels                                                |
| Admin | Plus: create trips, review hosts/trips/reels, curator pipeline, booking lookup |
| Super | Plus: Overview analytics, People directory, suspend accounts                   |

## Checks

Each app has its own checks, and CI runs them separately when that folder changes (`.github/workflows/`).

```sh
cd backend && npm run check && npm run test:integration
cd frontend && npm run build && npm test && npm run format:check
```

## Configuration

Settings come only from environment files that are never committed: `backend/.env` (see `backend/.env.example`) and frontend build variables (see `frontend/.env.example`). No hosts, IPs, domains or secrets are written in code.

## History

Both apps were imported with their full git history (`git log -- frontend` or `git log -- backend`). Earlier issue links point to the original repositories.
