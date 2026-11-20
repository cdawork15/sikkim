# Architecture and workflows

Sikkim Experiences is two deployables: a React single-page app and a Fastify API backed by PostgreSQL. Diagrams use Mermaid, which GitHub renders.

## System architecture

```mermaid
flowchart LR
  subgraph Client["Phone or desktop browser"]
    SPA["React 19 SPA<br/>(Vite build, sikkim-experiences)"]
  end

  subgraph Edge["Static hosting + reverse proxy"]
    Static["Static files<br/>index.html fallback"]
    Proxy["/v1 → API<br/>(HTTPS, nginx or CDN rewrite)"]
  end

  subgraph API["Fastify API (Node 24, this repo)"]
    direction TB
    Core["app.ts<br/>helmet · CORS · rate limits<br/>schema validation · request IDs"]
    Accounts["accounts<br/>register · login · sessions · privacy"]
    Hosts["hosts<br/>profiles · identity review"]
    Catalogue["catalogue<br/>experiences · search · reviews"]
    Bookings["bookings<br/>slots · holds · bookings · tickets"]
    Media["media<br/>uploads · ffmpeg · signed links · reels"]
    Community["community<br/>events · photos"]
    Admin["admin<br/>overview · curator CRM · users · bookings"]
    Core --> Accounts & Hosts & Catalogue & Bookings & Media & Community & Admin
  end

  subgraph Data["Data"]
    PG[("PostgreSQL<br/>app role: least privilege")]
    Disk[("Media directory<br/>private, signed URLs")]
  end

  Ops["Operator CLI<br/>npm run db:migrate · npm run admin"]

  SPA -- "HTML/JS/CSS" --> Static
  SPA -- "JSON over HTTPS<br/>Bearer token in memory" --> Proxy --> Core
  Accounts & Hosts & Catalogue & Bookings & Community & Admin --> PG
  Media --> PG
  Media --> Disk
  Ops -- "owner role" --> PG
```

Design rules that shape the code:

- **Configuration comes only from the environment.** Hosts, origins, database URLs, keys and feature modes are read in `src/config.ts` and validated at startup; nothing is hardcoded.
- **Two database roles.** `sikkim_owner` runs migrations and operator commands. The API connects as `sikkim_app`, which cannot create tables, change roles, rewrite consent history or edit the audit log.
- **Every write runs in one transaction** (`Database.transaction`) and records an `audit_logs` row.
- **Optimistic concurrency.** Editable records carry a `revision`; stale writes get `409` and the client reloads.
- **Errors never leak internals.** Responses are `{error: {code, message, requestId}}`; logs redact tokens and cookies.

## Sign-in with a one-time code

```mermaid
sequenceDiagram
  actor P as Person
  participant W as Web app
  participant A as API
  participant D as Email / SMS
  P->>W: phone or email
  W->>A: POST /auth/otp/request
  A->>A: 6-digit code, stored only as an HMAC hash (10 min)
  A->>D: send code
  D-->>P: code
  P->>W: enter code
  W->>A: POST /auth/otp/verify
  A->>A: check (max 5 tries) · find or create account
  A-->>W: session (+ isNewAccount)
  W-->>P: new account → name and interests (S02)
```

## Account types

```mermaid
flowchart LR
  U["User<br/>browse · book · save · share reels"] --> AD["Admin<br/>+ create trips · review · pipeline · bookings"]
  AD --> SU["Super<br/>+ overview analytics · people directory · suspend"]
```

Roles are granted only with `npm run admin` on the server.

## Request lifecycle

```mermaid
sequenceDiagram
  participant B as Browser (ApiClient)
  participant F as Fastify
  participant S as Service
  participant P as PostgreSQL
  B->>F: GET/POST /v1/... (Authorization: Bearer)
  F->>F: rate limit · JSON schema · CORS
  F->>S: handler(token, input, requestId)
  S->>P: BEGIN
  S->>P: lock account + session (accountAccess)
  S->>P: role check (admin endpoints)
  S->>P: queries / writes + audit row
  S->>P: COMMIT
  S-->>F: data
  F-->>B: 200 {data, page?} or {error}
  Note over B: Token refreshes before expiry;<br/>sessions last 30 min, max 24 h
```

## Booking workflow (free bookings)

```mermaid
sequenceDiagram
  actor T as Traveller
  participant A as API
  participant H as Host
  T->>A: GET /experiences/:id/slots
  T->>A: POST /me/seat-holds {slotId, quantity, requestKey}
  A-->>T: hold (≤ 10 min, capacity reserved)
  T->>A: POST /me/bookings {holdId, contact, guests}
  A-->>T: booking (reference) + ticket issued
  T->>A: GET /me/bookings/:id/ticket
  A-->>T: private QR token
  H->>A: POST /me/check-ins {token}
  A-->>H: checked in
  opt Before the cut-off
    T->>A: cancel or reschedule (policy hours)
  end
```

Paid bookings are blocked (`PAYMENT_UNAVAILABLE`) until a payment gateway is added.

## Host onboarding, verification and publishing

```mermaid
flowchart TD
  R["Curator registers<br/>(email + password)"] --> D["Host profile draft<br/>PUT /me/host"]
  D --> S["Submit for review<br/>POST /me/host/submit"]
  S -->|"HOST_VERIFICATION_MODE=disabled"| X["503 VERIFICATION_UNAVAILABLE"]
  S -->|manual| Q["Pending in admin queue"]
  Q --> V{"Admin checks identity<br/>in person · video call · document"}
  V -->|reject with reason| D
  V -->|"approve + method + expiry"| AP["Approved host<br/>(until approved_until)"]
  AP --> E["Create experience draft<br/>details · policies · media"]
  E --> ES["Submit experience"]
  ES --> ER{"Admin review<br/>provider reference recorded"}
  ER -->|reject| E
  ER -->|publish| P["Published listing"]
  P --> SL["Host adds dates (slots)"]
  SL --> BK["Bookable by travellers"]
  AP -.->|"suspend"| SU["Suspended: listings hidden"]
```

## Curator CRM pipeline

Leads live in `crm_leads`; every stage change and every call, visit or message is appended to `crm_lead_notes`.

```mermaid
stateDiagram-v2
  [*] --> idea
  idea --> contacted
  contacted --> interested
  interested --> agreement_sent
  agreement_sent --> agreed
  agreed --> onboarding: host profile linked
  onboarding --> live: listing published
  idea --> declined
  contacted --> declined
  interested --> paused
  paused --> interested
  live --> [*]
  declined --> [*]
```

Readiness checks tracked per lead: contact confirmed, agreement signed, photos or videos received, media rights note received, write-up final, site visit, verdict. The Overview tab turns these into the pilot tracker table per district.

## Admin workspace

| Tab       | Purpose                                                         | API                                                  |
| --------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Overview  | Live metrics, bookings by area, pipeline funnel, pilot tracker  | `GET /admin/overview`                                |
| Pipeline  | Curator CRM: search, filter, follow-ups, lead detail and notes  | `/admin/leads`, `/admin/leads/:id`, `.../notes`      |
| Approvals | Pending hosts, experiences and media, linking to review screens | `/admin/hosts`, `/admin/experiences`, `/admin/media` |
| Hosts     | Hosts by status, approval expiry                                | `GET /admin/hosts?status=`                           |
| Users     | Search people, roles (read-only), suspend or restore            | `/admin/users`, `/admin/users/:id/status`            |
| Bookings  | Look up by reference, guest, email or experience                | `GET /admin/bookings`                                |

Admin access itself is granted only with the operator command (`npm run admin -- grant --email=…`), so the API can never escalate privileges.

## Data model (main tables)

```mermaid
erDiagram
  users ||--o{ auth_identities : signs_in_with
  users ||--o{ auth_sessions : has
  users ||--o{ user_roles : has
  users ||--o| hosts : may_be
  hosts ||--o{ host_verifications : reviewed_in
  hosts ||--o{ experiences : offers
  experiences ||--o{ experience_slots : scheduled_as
  experience_slots ||--o{ seat_holds : reserved_by
  seat_holds ||--o| bookings : becomes
  bookings ||--o{ tickets : issues
  experiences ||--o{ experience_media : shows
  media_assets ||--o{ experience_media : used_in
  users ||--o{ community_events : creates
  crm_leads ||--o{ crm_lead_notes : logs
  crm_leads |o--o| hosts : linked_to
  users ||--o{ crm_leads : owns
```
