# Sikkim Experiences backend

Node 24 · TypeScript · Fastify · PostgreSQL. Requires PostgreSQL running and `psql` on your PATH.

## Run locally

```sh
npm ci
cp .env.example .env
```

Fill in `.env` passwords and database URLs; URL-encode special characters. Set `PGUSER`/`PGPASSWORD` if required by your PostgreSQL admin.

```sh
npm run db:setup # once; creates development and test databases
npm run build
npm run db:migrate
npm run db:seed
npm run dev
```

Next time: `npm run dev`. After updates: rebuild and run migrations.

Health: http://localhost:3000/v1/health/ready

Media needs `ffmpeg`, `MEDIA_STORAGE_DIR` and a 32+ character `MEDIA_SIGNING_KEY` in `.env`. Keep env files private.

## Checks

Copy `.env.test.example` to `.env.test` and set matching database passwords.

```sh
npm run check
npm run test:integration # resets sikkim_test
```

[API guide](docs/API.md) · [Remaining work](https://github.com/gauravyad86/sikkim-experiences-backend/issues)
