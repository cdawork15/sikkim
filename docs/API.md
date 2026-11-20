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

## Basics

- Success: `{data: ...}`; lists also return `page.nextCursor`. Empty responses use `204`.
- Errors: `{error: {code, message, requestId}}`. Check the code, not the message.
- IDs are UUIDs; money is integer paise; timestamps are ISO UTC. Travel dates use `Asia/Kolkata`.
- Use the returned cursor with the same filters. Catalogue uses `cursor`; other lists use `after`.
- Updates that require `revision` must send the latest value. Reload after a stale-write conflict.

## Login

Register with `displayName`, `email`, `password`; log in with `email`, `password`. Passwords are 8–128 characters. Keep tokens in memory. Sessions expire after 30 minutes; refresh rotates the token, up to 24 hours from sign-in. Reloading the frontend requires login again.

## Free booking flow

1. Get `/experiences/:id/slots`.
2. POST `/me/seat-holds` with `slotId`, `quantity`, `requestKey` (UUID).
3. POST `/me/bookings` with `holdId`, `contactName`, `contactEmail`, `guests`.
4. Get `/me/bookings/:id/ticket` for the private QR token.

Holds last up to ten minutes. Retry with the same key and identical fields; do not create another hold after a timeout. Tickets belong to the traveller; check-in belongs to the owning host. Never share ticket tokens publicly. Cancellation and date changes follow the original booking terms.

## Current limits

Free bookings only. Preview listings cannot be booked. Email verification/reset, real host approval, payments and production media storage are not connected. Community events/chat and managed Essentials content remain separate work.

[Remaining work](https://github.com/gauravyad86/sikkim-experiences-backend/issues)
