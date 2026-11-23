# Architecture and workflows

Sikkim Experiences is one repository with two deployables: a React single-page app (`frontend/`) and a Fastify API backed by PostgreSQL (`backend/`). Diagrams use Mermaid, which GitHub renders.

## System architecture

```mermaid
flowchart LR
  subgraph Client["Phone or desktop browser"]
    SPA["React 19 SPA<br/>(Vite build, frontend/)"]
  end

  subgraph Edge["CloudFront (HTTPS) → Caddy on the server"]
    Static["Static files<br/>index.html fallback"]
    Proxy["/v1 → API on 127.0.0.1:3000"]
  end

  subgraph API["Fastify API (Node 24, backend/)"]
    direction TB
    Core["app.ts<br/>helmet · CORS · rate limits<br/>schema validation · request IDs"]
    Accounts["accounts<br/>register · login · sessions · privacy"]
    Hosts["hosts<br/>profiles · identity review"]
    Catalogue["catalogue<br/>experiences · search · reviews"]
    Bookings["bookings<br/>slots · holds · bookings · tickets"]
    Media["media<br/>uploads · ffmpeg · signed links · reels"]
    Community["community<br/>events · photos · groups · chat"]
    Admin["admin<br/>overview · curator CRM · tasks<br/>scoring · automation · forecast · users"]
    Core --> Accounts & Hosts & Catalogue & Bookings & Media & Community & Admin
  end

  subgraph Data["Data"]
    PG[("PostgreSQL<br/>app role: least privilege")]
    Disk[("Media directory<br/>private, signed URLs")]
  end

  Ops["Operator CLI<br/>npm run db:migrate · npm run admin"]
  Claude["Claude API (optional)<br/>AI_PROVIDER=anthropic"]

  SPA -- "HTML/JS/CSS" --> Static
  SPA -- "JSON over HTTPS<br/>Bearer token in memory<br/>HttpOnly sx_session cookie (/v1/auth only)" --> Proxy --> Core
  Accounts & Hosts & Catalogue & Bookings & Community & Admin --> PG
  Media --> PG
  Media --> Disk
  Ops -- "owner role" --> PG
  Admin -. "AI brief, on request<br/>no phone/email" .-> Claude
```

In production all of this runs on one AWS server behind CloudFront, with RDS for PostgreSQL. Every push to `main` is deployed. See [AWS deployment](../deploy/aws/README.md) for the deployment diagram and pipeline.

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

### Or with a password

Every account can also add a password (Profile → Password & sign-in), then sign in with its mobile number **or** email and that password. The one-time code keeps working.

```mermaid
flowchart LR
  C["Signed in with a code"] --> S["PUT /me/password<br/>(current password needed to change)"]
  S --> O["Other devices signed out"]
  L["POST /auth/login<br/>email or phone + password"] --> F{"Identity found<br/>and password matches?"}
  F -- yes --> X["Session"]
  F -- no --> E["401 LOGIN_FAILED<br/>(same answer either way)"]
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
  Note over B: Signed in until sign-out: 30 days idle, 365 max.<br/>Reload → POST /v1/auth/resume with the HttpOnly cookie
```

## Booking workflow (free bookings)

```mermaid
sequenceDiagram
  actor T as Traveller
  participant A as API
  participant H as Host
  T->>A: GET /experiences/:id/slots
  T->>A: GET /me/bookings?status=upcoming&experienceId
  A-->>T: dates already booked (shown on the trip page)
  T->>A: POST /me/seat-holds {slotId, quantity, requestKey}
  alt Already booked on this date
    A-->>T: 409 ALREADY_BOOKED
  else
    A-->>T: hold (≤ 10 min, capacity reserved)
  end
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

Paid bookings are blocked (`PAYMENT_UNAVAILABLE`) until a payment gateway is added. A traveller gets one confirmed booking per date (`ALREADY_BOOKED`), checked under the same per-experience lock as capacity, so two tabs cannot both book the same date.

## Community groups and chat

```mermaid
sequenceDiagram
  actor M as Member
  participant A as API
  actor H as Host
  M->>A: POST /community/events/:id/join
  alt Event needs approval
    A-->>M: requested (no chat)
    H->>A: GET …/members, POST …/members/:userId/confirm
    A-->>H: confirmed
  else Free event, places left
    A-->>M: confirmed
  else Free event, full
    A-->>M: waiting (moves up when a place frees)
  end
  loop Every few seconds while the chat is open
    M->>A: GET …/messages?after=<last id>
  end
  M->>A: POST …/messages {body}
  Note over A: Host and confirmed members only (403 CHAT_NOT_ALLOWED otherwise).<br/>Posts lock the event row so ids commit in order.
```

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

### Lead score, automation and the AI brief

Every write to a lead runs these steps in one transaction (`admin/service.ts` → `admin/automation.ts`), so a lead and its automatic tasks are always saved together. The model call for an AI brief runs **outside** any transaction, between two short ones, so a slow model never holds a database lock.

```mermaid
flowchart TD
  New["POST /admin/leads"] --> Owner{"ownerId given?"}
  Owner -- no --> Route["Route: staff who works this district,<br/>else fewest open leads"]
  Owner -- yes --> Save
  Route --> Save["Save lead + 'Added at stage' note"]
  Save --> Play
  Edit["PATCH /admin/leads/:id"] --> Signed{"agreementSigned set<br/>before Agreed?"}
  Signed -- yes --> Agreed["stage = agreed"] --> Changed
  Signed -- no --> Changed{"stage changed?"}
  Changed -- yes --> Play["Stage playbook:<br/>cancel old automatic tasks,<br/>add this stage's task,<br/>fill empty/past follow-up"]
  Changed -- no --> Done
  Play --> Done["Response includes the lead score"]

  Brief["POST /admin/leads/:id/ai-brief"] --> T1["Tx 1: staff check, hourly cap,<br/>read lead, notes, tasks<br/>(no phone, email, contact name)"]
  T1 --> Model["Claude: structured JSON brief<br/>summary · next step · risks ·<br/>follow-up message · 6 ratings"]
  Model --> Check["Validate (ratings 1–5, required text)"]
  Check --> T2["Tx 2: store crm_ai_runs (model, tokens),<br/>AI note, audit"]
  T2 --> Staff["Staff copy/send the message<br/>or apply ratings with PATCH"]
```

**Lead score (0–100):** assessment average across the six criteria (35) + stage (25) + readiness checklist (20) + activity in the last 7/14/30 days (15, minus 5 if the follow-up is overdue) + verdict (5). Hot is 70+, warm 40+. Calls, visits, messages, notes, stage moves and finished tasks count as activity; automatic and AI entries do not.

**Revenue forecast (`GET /admin/crm/report`):** booking value = seats × slot price (pilot bookings are free and paid to hosts in cash). Run rate = average of the last three full months. Weighted pipeline = each open lead's `expected_monthly_paise` × its stage probability (5% idea … 90% onboarding). Projection per month = max(already booked, run rate) + weighted pipeline from next month on.

## Admin workspace

| Tab                  | Purpose                                                                                  | API                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Overview             | Live metrics, bookings by area, pipeline funnel, pilot tracker                           | `GET /admin/overview`                                                        |
| Pipeline             | Curator CRM: search, filter, follow-ups, lead score, lead detail, notes, tasks, AI brief | `/admin/leads`, `/admin/leads/:id`, `.../notes`, `.../tasks`, `.../ai-brief` |
| Tasks                | My or everyone's follow-up tasks; calendar (.ics) download                               | `/admin/tasks`, `/admin/tasks/:id`, `/admin/crm/tasks.ics`                   |
| CRM insights (super) | Revenue forecast, pipeline health, team performance, CSV export                          | `/admin/crm/report`, `/admin/crm/leads.csv`                                  |
| Approvals            | Pending hosts, experiences and media, linking to review screens                          | `/admin/hosts`, `/admin/experiences`, `/admin/media`                         |
| Hosts                | Hosts by status, approval expiry                                                         | `GET /admin/hosts?status=`                                                   |
| Users                | Search people, roles (read-only), suspend or restore                                     | `/admin/users`, `/admin/users/:id/status`                                    |
| Bookings             | Look up by reference, guest, email or experience                                         | `GET /admin/bookings`                                                        |

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
  community_events ||--o{ community_members : joined_by
  users ||--o{ community_members : joins
  community_events ||--o{ community_messages : chat
  crm_leads ||--o{ crm_lead_notes : logs
  crm_leads ||--o{ crm_tasks : follow_up
  crm_leads ||--o{ crm_ai_runs : briefed_by
  users ||--o{ crm_tasks : assigned
  crm_leads |o--o| hosts : linked_to
  users ||--o{ crm_leads : owns
```
