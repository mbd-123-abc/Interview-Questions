# ReadyOn Time-Off

A full-stack PTO management system that keeps employee leave balances consistent between a local application database and an authoritative external HCM system (think Workday or SAP).

**Core problem:** two systems managing the same PTO balance creates consistency and sync challenges — stale reads, race conditions, and out-of-order external updates all have to be handled explicitly.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Repository Structure](#repository-structure)
5. [Data Model](#data-model)
6. [API Reference](#api-reference)
7. [Core Data Flows](#core-data-flows)
8. [Source of Truth Rule](#source-of-truth-rule)
9. [Key System Problems & Solutions](#key-system-problems--solutions)
10. [Consistency & Concurrency Strategy](#consistency--concurrency-strategy)
11. [Failure Handling](#failure-handling)
12. [Reconciliation System](#reconciliation-system)
13. [Test Strategy](#test-strategy)
14. [Edge Cases](#edge-cases)
15. [Tradeoffs](#tradeoffs)
16. [Running Locally](#running-locally)
17. [Roadmap](#roadmap)
18. [Reflections](#reflections)

---

## System Overview

ReadyOn is an employee PTO request interface. Employees submit time-off requests, managers approve or reject them, and the system keeps balances in sync with an external HCM (Human Capital Management) system that is the authoritative source of truth.

The local database acts as a **derived cache** of HCM state. It exists to serve fast reads and to allow local validation without hitting the HCM API on every request. Any divergence between the two is resolved in favour of HCM.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Employee / Manager                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │  HTTP
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      React Frontend (Vite)                       │
│                       localhost:5173                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │  REST (proxied)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS Backend API                            │
│                       localhost:3000                             │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ PTO Requests│  │   Balances   │  │  HCM Webhook Receiver  │ │
│  │  (create /  │  │  (reserve /  │  │  (balance-update /     │ │
│  │  approve /  │  │  commit /    │  │   pto-request-event)   │ │
│  │  reject)    │  │  release)    │  └───────────┬────────────┘ │
│  └──────┬──────┘  └──────┬───────┘              │              │
│         │                │                       │              │
│  ┌──────▼────────────────▼───────────────────────▼───────────┐ │
│  │              Idempotency Service                           │ │
│  │         (scope + key + actorId deduplication)             │ │
│  └──────────────────────────┬─────────────────────────────── ┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────┐   │
│  │                    Prisma ORM                            │   │
│  └──────────────────────────┬────────────────────────────── ┘  │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────┐   │
│  │              SQLite (local cache / DB)                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         Reconciliation Worker (hourly cron)              │   │
│  │    Compares local balances → HCM batch → repairs drift   │   │
│  └──────────────────────────┬────────────────────────────── ┘  │
└─────────────────────────────┼────────────────────────────────── ┘
                              │  HTTP (mock in dev/test)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HCM System (external)                         │
│              Source of truth for all PTO balances                │
│   Emits webhooks → /webhooks/hcm/balance-update                  │
│                  → /webhooks/hcm/pto-request-event               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| Backend | NestJS 10, TypeScript |
| ORM | Prisma 5 |
| Database | SQLite (dev/test) — swap to Postgres for production |
| Validation | class-validator, class-transformer |
| Scheduling | @nestjs/schedule (cron) |
| HTTP client | @nestjs/axios |
| Logging | pino (structured JSON in prod, pino-pretty in dev) |
| Security | helmet, HMAC-SHA256 webhook signature verification |
| Testing | Jest, Supertest |

---

## Repository Structure

```
Interview-Questions/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # All models and relations
│   │   └── migrations/            # Migration history
│   └── src/
│       ├── main.ts                # Bootstrap: helmet, CORS, ValidationPipe
│       ├── app.module.ts          # Root module wiring
│       ├── common/
│       │   ├── guards/
│       │   │   └── hcm-webhook.guard.ts   # HMAC signature verification
│       │   ├── logging/
│       │   │   └── logger.service.ts      # pino wrapper
│       │   └── pipes/
│       │       └── validation.pipe.ts     # Global input validation
│       ├── config/
│       │   ├── configuration.ts   # Env var loading
│       │   ├── database.config.ts
│       │   └── hcm.config.ts
│       ├── jobs/
│       │   └── reconciliation.worker.ts
│       ├── modules/
│       │   ├── audit/             # Immutable event log
│       │   ├── balances/          # Balance CRUD + optimistic locking
│       │   ├── employees/         # Employee CRUD
│       │   ├── hcm/               # Webhook receiver + HCM client interface
│       │   │   └── clients/
│       │   │       ├── hcm-client.interface.ts
│       │   │       └── mock-hcm-client.service.ts
│       │   ├── idempotency/       # Scoped deduplication service
│       │   ├── locations/         # Location CRUD
│       │   ├── pto-requests/      # Core business logic
│       │   └── reconciliation/    # Drift detection + repair
│       ├── prisma/
│       │   ├── prisma.module.ts
│       │   └── prisma.service.ts
│       └── tests/
│           ├── unit/              # Mocked service-layer tests
│           ├── integration/       # Full HTTP → DB → mock HCM
│           ├── concurrency/       # Parallel request race condition tests
│           ├── failure/           # HCM outage / timeout injection
│           └── reconciliation/    # Drift detection and repair tests
└── frontend/
    └── src/
        ├── api.ts                 # Typed API client
        ├── App.tsx                # Main UI
        └── main.tsx
```

---

## Data Model

### Employee
| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| hcmEmployeeId | String | Unique ID from HCM system |
| name | String | |
| email | String | Unique |
| managerId | String? | Self-referential FK |

### Location
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| code | String | Unique (e.g. `NYC`) |
| name | String | |
| timezone | String | |

### Balance *(local cache of HCM truth)*
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| employeeId | String | FK → Employee |
| locationId | String | FK → Location |
| balanceMinutes | Int | Total accrued minutes |
| pendingMinutes | Int | Reserved by PENDING requests |
| version | Int | Optimistic lock counter |
| hcmBalanceVersion | String? | Version token from HCM |
| lastSyncedAt | DateTime? | Last HCM sync timestamp |

`available = balanceMinutes - pendingMinutes` — this is what new requests are validated against.

### PTORequest
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| employeeId / locationId | String | FKs |
| startDate / endDate | DateTime | |
| requestedMinutes | Int | |
| status | String | `PENDING` → `APPROVED` \| `REJECTED` |
| idempotencyKey | String | Client-supplied dedup key |
| hcmRequestId | String? | Set after HCM sync |
| version | Int | Optimistic lock counter |

### Supporting Models
- **AuditEvent** — immutable log of every state change with entity type, action, payload, and source
- **IdempotencyKey** — scoped deduplication table (`scope + key + actorId` unique constraint)
- **HcmBalanceSnapshot** — point-in-time record of every balance value received from HCM (both realtime webhooks and batch reconciliation)
- **ReconciliationRun** — tracks each reconciliation execution: status, rows inspected, drift count, repairs applied, errors
- **BalanceAdjustmentEvent** — ledger of every delta applied to a balance

---

## API Reference

### PTO Requests
| Method | Path | Description |
|---|---|---|
| `POST` | `/pto-requests` | Submit a new PTO request. Requires `x-idempotency-key` header. |
| `GET` | `/pto-requests/:id` | Get a single request by ID |
| `GET` | `/pto-requests/employee/:employeeId` | Get all requests for an employee |
| `POST` | `/pto-requests/:id/approve` | Approve a pending request. Requires `x-idempotency-key`. |
| `POST` | `/pto-requests/:id/reject` | Reject a pending request. Requires `x-idempotency-key`. |

### Balances
| Method | Path | Description |
|---|---|---|
| `GET` | `/balances/:id` | Get balance by ID |
| `GET` | `/balances/employee/:employeeId` | Get all balances for an employee |
| `POST` | `/balances` | Create a balance record |
| `PUT` | `/balances/:id` | Update a balance record |

### Employees
| Method | Path | Description |
|---|---|---|
| `GET` | `/employees` | List all employees |
| `GET` | `/employees/:id` | Get employee by ID |
| `POST` | `/employees` | Create employee |
| `PUT` | `/employees/:id` | Update employee |

### Locations
| Method | Path | Description |
|---|---|---|
| `GET` | `/locations` | List all locations |
| `GET` | `/locations/:id` | Get location by ID |
| `POST` | `/locations` | Create location |
| `PUT` | `/locations/:id` | Update location |

### HCM Webhooks *(HMAC-SHA256 verified in production)*
| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/hcm/balance-update` | HCM pushes a balance change |
| `POST` | `/webhooks/hcm/pto-request-event` | HCM pushes a PTO status update |

### Reconciliation
| Method | Path | Description |
|---|---|---|
| `GET` | `/reconciliation/status` | Health check |
| `POST` | `/reconciliation/run` | Trigger a manual reconciliation run |

---

## Core Data Flows

### 1. PTO Request Submission

```
Client
  │
  ├─ POST /pto-requests  { x-idempotency-key: "uuid" }
  │
  ▼
IdempotencyService.execute("PTO_REQUEST_CREATE", key, employeeId)
  │
  ├─ Duplicate key? → return cached result immediately
  │
  ▼
Prisma.$transaction
  ├─ Read balance (with version)
  ├─ Check: balanceMinutes - pendingMinutes >= requestedMinutes
  ├─ balance.updateMany WHERE version = N  →  pendingMinutes += requested, version++
  │     └─ count === 0? → ConflictException (optimistic lock miss, client retries)
  └─ pTORequest.create { status: PENDING }
  │
  ▼
AuditService.record({ action: "CREATE" })
```

### 2. Approval Flow

```
POST /pto-requests/:id/approve  { x-idempotency-key, managerId }
  │
  ▼
IdempotencyService.execute("PTO_REQUEST_APPROVE", key, managerId)
  │
  ▼
Prisma.$transaction
  ├─ Read balance (with version)
  ├─ Check: pendingMinutes >= requestedMinutes
  ├─ balance.updateMany WHERE version = N
  │     pendingMinutes -= requested, balanceMinutes -= requested, version++
  └─ pTORequest.update { status: APPROVED }
  │
  ▼
HcmService.createPtoRequest(...)   ← best-effort, non-blocking
  ├─ Success → repository.update { hcmRequestId }
  └─ Failure → AuditEvent { action: "HCM_SYNC_FAILED" }
               (reconciliation will repair the hcmRequestId later)
  │
  ▼
AuditService.record({ action: "APPROVE" })
```

### 3. HCM Webhook — Balance Update

```
POST /webhooks/hcm/balance-update
  │
  ├─ HcmWebhookGuard: verify X-HCM-Signature (HMAC-SHA256)
  │
  ▼
HcmWebhookService.processBalanceUpdate
  ├─ hcmBalanceSnapshot.findUnique({ externalId }) → duplicate? return early
  │
  ▼
Prisma.$transaction
  ├─ hcmBalanceSnapshot.create { externalId }   ← unique constraint = race guard
  ├─ balance.update { balanceMinutes, hcmBalanceVersion, lastSyncedAt }
  └─ auditEvent.create { action: "HCM_BALANCE_UPDATE" }
```

### 4. Balance Validation Flow

```
POST /pto-requests  { requestedMinutes: 480 }
  │
  ▼
Inside Prisma.$transaction:
  │
  ├─ balance = tx.balance.findUnique({ employeeId, locationId })
  │     └─ null? → 400 "No balance record found"
  │
  ├─ available = balance.balanceMinutes - balance.pendingMinutes
  │     └─ available < requestedMinutes? → 400 "Insufficient available balance"
  │
  └─ balance.updateMany WHERE version = balance.version
        └─ count === 0? → 409 "Balance reservation conflict, please retry"
           (another request won the optimistic lock race)
```

The key design choice: balance is read **and** written inside the same transaction, so the version check is atomic. There is no window between the read and the write where another request can sneak in.

### 5. UI Cache Update Flow

```
Frontend (React)
  │
  ├─ On load: GET /balances/employee/:id  → render current balance
  │
  ├─ User submits PTO request
  │     POST /pto-requests → 201 { status: PENDING }
  │     → re-fetch balance → pendingMinutes increased, available decreased
  │
  ├─ Manager approves
  │     POST /pto-requests/:id/approve → 201 { status: APPROVED }
  │     → re-fetch balance → balanceMinutes decreased, pendingMinutes cleared
  │
  └─ HCM pushes balance update (webhook)
        Backend updates local DB
        → next frontend poll / page refresh reflects new balance
```

The frontend does not maintain its own cache layer — it re-fetches from the backend after each mutation. The backend's local DB is the cache; the frontend always reads from it.

### 6. Reconciliation Run

```
POST /reconciliation/run  (or hourly cron)
  │
  ▼
ReconciliationService.reconcile
  │
  ├─ ReconciliationRun.create { status: RUNNING }
  │
  ├─ Paginate HCM batch balances (page=1, limit=100, ...)
  │     For each record:
  │       ├─ hcmBalanceSnapshot.create { source: BATCH }
  │       ├─ No local balance? → balance.create (repair)
  │       ├─ Drift detected?   → balance.update to HCM value + auditEvent
  │       └─ No drift?         → update hcmBalanceVersion + lastSyncedAt only
  │
  └─ ReconciliationRun.update { status: COMPLETED, driftCount, repairsApplied }
```

---

## Source of Truth Rule

> **HCM is authoritative. ReadyOn is a derived cache.**

- Every balance value in the local DB is a snapshot of what HCM last reported.
- Any mismatch between local and HCM → **HCM wins**, local is overwritten.
- This applies to both real-time webhooks and batch reconciliation.
- The `hcmBalanceVersion` field on `Balance` tracks which HCM version the local record reflects.

---

## Key System Problems & Solutions

### A. Stale Data

**Problem:** The local balance is a cache. Between syncs, HCM may have changed the balance independently — an admin edit, an anniversary bonus, or a correction. A PTO request validated against stale local data could be approved for more time than the employee actually has.

**Solution (layered):**
1. Real-time webhooks keep the cache fresh for most changes.
2. Hourly reconciliation catches anything the webhooks missed.
3. `lastSyncedAt` and `hcmBalanceVersion` make staleness visible.
4. The `HcmBalanceSnapshot` table preserves every value ever received from HCM for audit and debugging.

### B. Race Conditions

**Problem:** Two employees (or two browser tabs) submit PTO requests simultaneously. Both read the same balance, both see sufficient funds, both proceed — resulting in a double-spend and a negative available balance.

**Solution — optimistic locking:**
```
balance.updateMany WHERE employeeId = X AND locationId = Y AND version = N
  SET pendingMinutes += requested, version = N+1
```
If `count === 0`, another request already incremented the version. The losing request gets a `409 Conflict` and the client retries. The balance **never goes negative** — proven by the concurrency test suite.

### C. External HCM Updates

**Problem:** HCM changes a balance without going through ReadyOn — bonus accrual, admin correction, direct HCM entry. ReadyOn has no way to know unless HCM tells it.

**Solution:**
- HCM pushes real-time events to `/webhooks/hcm/balance-update`.
- Webhook delivery is idempotent: the `externalId` unique constraint on `HcmBalanceSnapshot` means duplicate deliveries are silently ignored.
- Hourly reconciliation acts as a safety net for any missed webhooks.

---

## Consistency & Concurrency Strategy

This system uses a **hybrid consistency model**:

| Concern | Approach |
|---|---|
| Balance reservation | Strong consistency — Prisma transaction + optimistic lock |
| HCM sync on approval | Eventual consistency — best-effort, audited on failure |
| Webhook processing | Idempotent upsert — unique constraint on `externalId` |
| Drift correction | Eventual consistency — hourly reconciliation |
| Duplicate requests | Idempotency table — `scope + key + actorId` unique constraint |

**Why not query HCM on every request?**
HCM APIs are external, slow, and can be unavailable. Querying them synchronously on every PTO submission would make the system's availability dependent on HCM's availability. The cache + reconciliation pattern gives fast local reads with eventual correctness.

**Idempotency key lifecycle:**
- `PENDING` → request is in-flight (concurrent duplicate gets `409`)
- `COMPLETED` → result is cached, duplicate returns the stored response
- `FAILED` → record is deleted so the client can retry with the same key

---

## Failure Handling

| Failure | Behaviour |
|---|---|
| HCM timeout during approval | Local approval succeeds. `HCM_SYNC_FAILED` audit event written. `hcmRequestId` left null. Reconciliation or a later HCM webhook repairs it. |
| HCM 500 during approval | Same as timeout — local state is never rolled back for an external failure. |
| HCM down during reconciliation | `ReconciliationRun` marked `FAILED` with `lastError`. Next hourly run retries. |
| Duplicate webhook delivery | Idempotency check on `externalId` returns `{ duplicate: true }` immediately. No state change. |
| Partial failure (DB write succeeded, HCM call failed) | Audit trail captures the gap. HCM pushes a corrective webhook when it recovers, or reconciliation catches it. |
| Optimistic lock miss | `409 Conflict` returned to client. Client retries with the same idempotency key — the key is still `PENDING` so the retry waits, or `FAILED` so it re-executes cleanly. |

---

## Reconciliation System

**Purpose:** act as the safety net that corrects any drift between the local cache and HCM truth, regardless of cause.

**Trigger:** hourly cron (`@Cron(CronExpression.EVERY_HOUR)`) or manual `POST /reconciliation/run`.

**Logic:**
1. Paginate through all balances from HCM batch API (100 records per page).
2. For each HCM record:
   - Write an `HcmBalanceSnapshot` with `source: BATCH`.
   - If no local balance exists → create one (repair).
   - If local `balanceMinutes` ≠ HCM value → overwrite local, write `RECONCILIATION_ADJUSTMENT` audit event, increment `driftCount`.
   - If values match → update `hcmBalanceVersion` and `lastSyncedAt` only.
3. Each row is processed in its own transaction — a single row failure is logged and skipped, it does not abort the entire run.
4. `ReconciliationRun` record tracks: `inspectedRows`, `driftCount`, `repairsApplied`, `errorsCount`, `lastError`.

---

## Event / Sync Strategy

ReadyOn uses an **inbound webhook pattern** as a lightweight substitute for a full event bus. HCM acts as the event producer; ReadyOn is the consumer.

### What's implemented

| Event | Source | Endpoint | Handling |
|---|---|---|---|
| Balance changed | HCM | `POST /webhooks/hcm/balance-update` | Idempotent upsert — unique constraint on `externalId` prevents double-processing |
| PTO request status changed | HCM | `POST /webhooks/hcm/pto-request-event` | Updates `hcmRequestId` on the local PTORequest record |

Both endpoints are protected by HMAC-SHA256 signature verification (`X-HCM-Signature` header) when `HCM_WEBHOOK_SECRET` is set in the environment.

### How idempotency is enforced on webhooks

HCM may deliver the same event multiple times (network retries, at-least-once delivery). The system handles this at two levels:

- **Balance updates:** `HcmBalanceSnapshot.externalId` has a `@unique` constraint. A duplicate delivery hits the unique constraint and returns `{ duplicate: true }` without touching the balance.
- **PTO events:** `IdempotencyKey` table with `scope = 'HCM_PTO_EVENT'` and `key = externalEventId`. Same mechanism.

### What's mocked / future

The `HcmClient` interface (`hcm-client.interface.ts`) is injected via NestJS DI. In development and tests, `MockHcmClientService` is used. In production, this would be replaced with a real HTTP client — or, ideally, a message queue consumer.

> **Future improvement:** replace the polling/webhook model with a real event stream (Kafka or RabbitMQ). HCM publishes balance and PTO events to a topic; ReadyOn consumes them with at-least-once delivery guarantees and idempotent processing. This eliminates the reconciliation window and makes the system reactive rather than periodic.

---

## Test Strategy

**93 tests across 7 suites — all passing.**

```
npm test          # run all suites
npm run test:unit
npm run test:integration
npm run test:concurrency
npm run test:reconciliation
npm run test:failure
```

### Unit Tests (`tests/unit/`)
Pure service-layer tests with all dependencies mocked.

- `pto-requests.service.unit.spec.ts` — validation, status transitions, idempotency delegation, HCM failure isolation, optimistic lock miss paths
- `balances.service.unit.spec.ts` — reserve/commit/release logic, insufficient balance rejection
- `reconciliation.service.unit.spec.ts` — drift detection, repair logic, error counting, run status tracking

### Integration Tests (`tests/integration/`)
Full HTTP → NestJS → Prisma → SQLite stack with a controllable mock HCM client.

- PTO submission, approval, rejection end-to-end
- Balance state verified in DB after each operation
- Audit event creation verified
- Idempotency: duplicate submission returns same ID, creates one DB record

### Concurrency Tests (`tests/concurrency/`)
Parallel HTTP requests fired with `Promise.all` against a real running app.

- Two simultaneous requests against a balance that covers only one → exactly one succeeds
- Five simultaneous requests → available balance never goes negative
- Two managers racing to approve the same request → exactly one approval, balance deducted once
- Same idempotency key sent 5 times concurrently → one DB record, all responses share the same ID
- **Pending conservation invariant:** `sum(PENDING requestedMinutes) === balance.pendingMinutes`

### Failure Injection Tests (`tests/failure/`)
`hcm.setFailure('error' | 'timeout')` simulates HCM outages mid-flow.

- HCM down during approval → local approval succeeds, `HCM_SYNC_FAILED` audit written
- HCM timeout → local state consistent, no corruption
- HCM recovers → webhook repairs `hcmRequestId`
- HCM 500 during reconciliation → run marked `FAILED`, `lastError` populated
- Stale cache scenario → reconciliation self-corrects to HCM truth

### Reconciliation Tests (`tests/reconciliation/`)
- Anniversary bonus: HCM independently increases balance → reconciliation heals local
- Missing local record → created from HCM data
- Stale local data → overwritten with HCM truth
- No drift → zero repairs, correct `inspectedRows` count
- Multiple employees → all reconciled in one run
- `ReconciliationRun` record lifecycle: `RUNNING` → `COMPLETED` / `FAILED`
- `HcmBalanceSnapshot` records created with `source: BATCH`

---

## Edge Cases

| Case | Handling |
|---|---|
| `requestedMinutes > available` | `400 Bad Request` — checked inside transaction |
| `balanceMinutes = 0` | `400 Bad Request` |
| All balance already pending | `400 Bad Request` (`available = 0`) |
| `startDate > endDate` | `400 Bad Request` |
| Missing `x-idempotency-key` header | `400 Bad Request` |
| Duplicate request (same idempotency key) | Returns cached result, no second DB write |
| Approving an already-approved request | `409 Conflict` |
| Webhook delivered N times | Processed exactly once, rest return `{ duplicate: true }` |
| Out-of-order webhook delivery | Both processed (different `externalId`s), reconciliation corrects final state |
| HCM has record, local DB does not | Reconciliation creates the local record |
| Unknown employee/location in HCM batch | Skipped with `SKIP_UNKNOWN_ENTITY` audit event |
| Partial failure (local saved, HCM failed) | Audited as `HCM_SYNC_FAILED`, repaired by webhook or reconciliation |

---

## Tradeoffs

**Cache vs. real-time HCM query**
Querying HCM on every request would give perfect accuracy but couples availability to an external system. The cache + reconciliation pattern keeps the API fast and available even when HCM is slow or down. The cost is a window of potential staleness, which is bounded by the reconciliation interval.

**Optimistic locking vs. pessimistic locking**
Optimistic locking (version field + `updateMany WHERE version = N`) avoids holding DB locks across network calls and scales better under low-contention workloads. The tradeoff is that clients must handle `409` and retry. For a PTO system where concurrent submissions on the same employee are rare, this is the right call.

**SQLite vs. Postgres**
SQLite is used for development and testing — zero setup, fast, file-based. The schema and Prisma queries are written to be compatible with Postgres. Switching is a one-line change in `schema.prisma` and a `DATABASE_URL` update.

**Eventual consistency for HCM sync**
The approval flow commits locally first, then syncs to HCM as a best-effort call. This means there is a window where ReadyOn says `APPROVED` but HCM doesn't know yet. The alternative — making HCM sync part of the transaction — would mean a failed HCM call rolls back a valid approval. The audit trail and reconciliation make the eventual consistency window observable and self-healing.

**Mock HCM client**
The real HCM client interface is defined (`hcm-client.interface.ts`) and injected via NestJS DI. The mock is swapped in for all tests and local dev. Replacing it with a real HTTP client requires no changes to business logic.

---

## Running Locally

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run start:dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Backend runs on `http://localhost:3000`.  
Frontend runs on `http://localhost:5173` and proxies all API calls to the backend.

**Run tests:**
```bash
cd backend
npm test                    # all suites
npm run test:unit           # unit only
npm run test:integration    # integration only
npm run test:concurrency    # race condition tests
npm run test:failure        # failure injection tests
npm run test:reconciliation # reconciliation tests
```

---

## Roadmap

### Secure Frontend *(planned)*
The current frontend is a minimal scaffold. A production-ready UI would include:

- **Authentication** — JWT-based login with refresh tokens; role-based access (employee vs. manager views)
- **Authorization** — route guards so employees can only see their own requests; managers see their direct reports only
- **Input sanitization** — XSS prevention on all user-supplied fields rendered to the DOM
- **HTTPS enforcement** — HSTS header already set by `helmet` on the backend; frontend served over TLS in production
- **Content Security Policy** — restrict script sources to prevent injection attacks
- **Secure token storage** — `httpOnly` cookies instead of `localStorage` for auth tokens
- **Session timeout** — automatic logout on inactivity

### Other Planned Improvements

- **Real event streaming** — replace the mock HCM client with a Kafka or RabbitMQ consumer so balance updates are pushed in real time rather than polled
- **Distributed locking** — Redis-based locks for multi-instance deployments where SQLite optimistic locking is not sufficient
- **Dead letter queue** — failed HCM sync attempts queued for retry with exponential backoff instead of relying solely on reconciliation
- **Observability** — structured metrics (Prometheus), distributed tracing (OpenTelemetry), and alerting on reconciliation drift rates
- **Multi-region consistency** — conflict resolution strategy for geographically distributed deployments
- **Postgres migration** — one-line `schema.prisma` change; connection pooling via PgBouncer

---

## Reflections

**Most difficult part personally:** building the project structure. Deciding how to split modules, where business logic lives vs. the repository layer, and how to wire idempotency across all three mutation flows (create, approve, reject) without duplicating code took the most deliberate thought.

**Things I applied that I already knew:** designing before coding. Sketching the data model and the consistency strategy first meant the implementation had clear constraints to work within. Every architectural decision — optimistic locking, the idempotency table, the reconciliation pattern — was made at the design stage, not discovered mid-implementation.

**Things I learned:** vibe coding with AI as a development partner, and how to write tests alongside an AI agent. The most interesting discovery was that AI-assisted testing is most effective when you write the test *intent* first (what invariant should hold?) and let the agent handle the boilerplate — the concurrency and failure injection tests came out of that workflow.
