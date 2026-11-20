# Sikkim Experiences

React · TypeScript · Vite.

## Run

Use Node 22.12+ and start the backend on port 3000.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. `/v1` requests go to the backend. Apply its latest migrations first.

## Check

```sh
npm run build
npm test
npx playwright install chromium webkit
npm run test:api
npm run test:e2e
npm run format:check
```

Accounts, discovery, media, saves and free bookings are connected. Paid checkout, real host verification, email verification/reset and Community events/chat are unfinished. Reloading requires login again.

Sample mode: `VITE_DATA_MODE=demo npm run dev`.

Deploy `dist/` with an `index.html` fallback and `/v1` backend proxy. Never put secrets in frontend env variables.

[Design and preview notes](docs/DEMO.md) · [Remaining work](docs/planning/BACKLOG.md)
