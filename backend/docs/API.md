# API quick guide

Base path: `/v1`. Private requests need `Authorization: Bearer <token>`.

| Area                             | Routes and request fields                                 |
| -------------------------------- | --------------------------------------------------------- |
| Health                           | `GET /health/live`, `GET /health/ready`                   |
| Accounts and password login      | [accounts/routes.ts](../src/accounts/routes.ts)           |
| Host profiles and approval       | [hosts/routes.ts](../src/hosts/routes.ts)                 |
| Experiences, filters and reviews | [catalogue/routes.ts](../src/catalogue/routes.ts)         |
| Uploads and media review         | [media/routes.ts](../src/media/routes.ts)                 |
| Reels and stories                | [media/content-routes.ts](../src/media/content-routes.ts) |
| Saves and likes                  | [media/action-routes.ts](../src/media/action-routes.ts)   |
| Dates, bookings and tickets      | [bookings/routes.ts](../src/bookings/routes.ts)           |
| Community events and photos      | [community/routes.ts](../src/community/routes.ts)         |
| Admin workspace and curator CRM  | [admin/routes.ts](../src/admin/routes.ts)                 |

## Basics

- Success: `{data: ...}`; lists also return `page.nextCursor`. Empty responses use `204`.
- Errors: `{error: {code, message, requestId}}`. Check the code, not the message.
- IDs are UUIDs; money is integer paise; timestamps are ISO UTC. Travel dates use `Asia/Kolkata`.
- Use the returned cursor with the same filters. Catalogue uses `cursor`; other lists use `after`.
- Updates that require `revision` must send the latest value. Reload after a stale-write conflict.

## Login

Sign in with a one-time code (`POST /auth/otp/request`, then `/auth/otp/verify`) or a password. Log in with `password` plus **either** `email` or `phone` (local numbers get the default country code). Register with `displayName`, `email`, `password`; an email that already signs in with a code returns 409. Any signed-in account can add a password with `PUT /me/password` `{ newPassword }`; changing it also needs `currentPassword`, and signs out the account's other sessions. `GET /me` reports `hasPassword`. Passwords are 8–128 characters. Keep tokens in memory. Sessions expire after 30 minutes; refresh rotates the token, up to 24 hours from sign-in. Reloading the frontend requires login again.

## Uploading a reel

`POST /me/media` with `purpose: public_content` and `contentType` `video/mp4`, `video/webm` or `video/quicktime` (phone camera .mov), up to 50 MB and 60 seconds. `PUT` the file to `uploadUrl`, poll `GET /me/media/:id` until `ready`, then `POST /me/reels` with `assetId`. Every video is transcoded to H.264 MP4 with metadata removed. If the app can't read the length first, send a caption cue up to 60 s; the server trims it to the real length.

## Your profile

`GET /me` returns the signed-in person's profile: name, language, roles, interests, preferences, their own sign-in `email` and `phone` (either may be `null`), `createdAt`, and `summary` with `bookings`, `saved` and `reels` counts. `PATCH /me/preferences` accepts any subset of fields, so a screen can save only what it shows.

## Free booking flow

1. Get `/experiences/:id/slots`.
2. POST `/me/seat-holds` with `slotId`, `quantity`, `requestKey` (UUID).
3. POST `/me/bookings` with `holdId`, `contactName`, `contactEmail`, `guests`.
4. Get `/me/bookings/:id/ticket` for the private QR token.

Holds last up to ten minutes. Retry with the same key and identical fields; do not create another hold after a timeout. Tickets belong to the traveller; check-in belongs to the owning host. Never share ticket tokens publicly. Cancellation and date changes follow the original booking terms.

## Admin workspace

All `/admin/*` routes need a signed-in account with the `admin` role; others get `403 FORBIDDEN`. Admin lists use the opaque `after` cursor returned in `page.nextCursor`.

| Route                                  | Use                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /admin/overview`                  | Review queue counts, bookings (30 days, next 7 days, by area), hosts, pipeline tracker |
| `GET /admin/leads`                     | Filters: `stage`, `district`, `q`, `followUpDue=true`, `after`. Each lead has `score`  |
| `POST /admin/leads`                    | Create a curator lead (`name` required; `code` like `PKG-02`). No `ownerId` = routed   |
| `GET /admin/leads/:id`                 | Lead with `notes`, `tasks` and `assistant: {enabled, latest}` (the last AI brief)      |
| `PATCH /admin/leads/:id`               | Send `revision` plus changed fields; stage changes add a note and run the playbook     |
| `POST /admin/leads/:id/notes`          | `kind` (`call`, `visit`, `message`, `note`) and `body`                                 |
| `POST /admin/leads/:id/tasks`          | `title`, optional `dueOn` (date) and `assigneeId` (staff; default: the lead owner)     |
| `GET /admin/tasks`                     | `scope=mine\|everyone` (default mine), `status=open\|done\|cancelled` (default open)   |
| `PATCH /admin/tasks/:id`               | Any of `status`, `title`, `dueOn`, `assigneeId`. `done` logs activity on the lead      |
| `POST /admin/leads/:id/ai-brief`       | Body `{}`. AI brief for the lead (see below)                                           |
| `GET /admin/crm/tasks.ics`             | My open tasks with due dates as an iCalendar file (Google, Apple, Outlook)             |
| `GET /admin/crm/leads.csv`             | **Super.** Every lead with score and ratings, for spreadsheets                         |
| `GET /admin/crm/report`                | **Super.** Lead bands, pipeline health, team performance, revenue forecast             |
| `GET /admin/users`, `/admin/users/:id` | Search by `q`, filter by `role`; detail shows host, bookings, recent activity          |
| `POST /admin/users/:id/status`         | `{status: "suspended" \| "active"}`; suspending signs the person out everywhere        |
| `GET /admin/bookings`                  | Search by reference, guest name, email or experience; filter by `status`               |
| `POST /admin/hosts/:id/decisions`      | Approving a real host needs `method`: `in_person`, `video_call` or `document`          |

### Curator CRM fields

- **Assessment:** `scoreUniqueness`, `scoreStory`, `scoreReadiness`, `scoreAccess`, `scoreSafety`, `scorePhoto`, each `1`–`5` or `null`.
- **Forecast:** `expectedMonthlyPaise`, the booking value the listing should bring each month once live (integer paise or `null`).
- **Score** (read-only): `score: {score, band, assessed, factors[]}`. `band` is `hot` (70+), `warm` (40+), `cold`, `live` or `closed`. The factors are assessment (35), stage (25), readiness checklist (20), recent activity (15, minus 5 when the follow-up is overdue) and verdict (5). `not_suitable` caps the score at 10.
- **Automation:** a lead created without `ownerId` goes to the staff member who already works its district, else to whoever has the fewest open leads. Entering a stage adds that stage's task (due in 3–7 days) for the owner, cancels older automatic tasks and fills an empty or past follow-up date (unless the same request sets `nextFollowUp`). Setting `agreementSigned: true` on a lead before "Agreed" moves it to `agreed`.

### AI brief

`POST /admin/leads/:id/ai-brief` returns `201 {data: {id, brief, model, createdAt, requestedBy}}`. `brief` has `summary`, `nextAction`, `risks[]`, `followUpMessage`, `assessment.{uniqueness,story,readiness,access,safety,photo}.{rating,reason}` and `confidence`. Suggestions are never saved to the lead; staff apply ratings with a normal `PATCH`. Phone numbers, emails and contact names are not sent to the model.

| Error                | When                                                      |
| -------------------- | --------------------------------------------------------- |
| `503 AI_DISABLED`    | `AI_PROVIDER=disabled` (the default)                      |
| `429 AI_LIMIT`       | The person used `AI_ASSIST_HOURLY_LIMIT` briefs this hour |
| `422 AI_DECLINED`    | The model declined                                        |
| `502 AI_FAILED`      | The model's answer could not be read; try again           |
| `503 AI_UNAVAILABLE` | The AI service could not be reached                       |

Roles are not editable through the API. Grant or remove admin access on the server with `npm run admin -- grant --email=…`, `revoke --email=…` or `list`.

## Current limits

Free bookings only. Preview listings cannot be booked. Real hosts are approved through manual identity checks (`HOST_VERIFICATION_MODE=manual`). Email verification/reset, payments, Community chat and production object storage for media are not connected yet.

[Remaining work](https://github.com/gauravyad86/sikkim-experiences-backend/issues)
