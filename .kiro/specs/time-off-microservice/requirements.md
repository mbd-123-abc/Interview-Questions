# Requirements: Time-Off Microservice (ReadyOn)

## Introduction

ReadyOn is an employee-facing PTO management system. It maintains local copies of employee leave balances and synchronizes them with an external HCM system (Workday/SAP style) that is the authoritative source of truth. Employees submit PTO requests through ReadyOn; managers approve or reject them. The system must defend against race conditions, stale data, duplicate requests, and HCM outages while guaranteeing balance integrity at all times.

---

## Glossary

| Term | Definition |
|---|---|
| HCM | Human Capital Management system (Workday/SAP). Source of truth for balances. |
| Balance | Minutes of PTO available to an employee at a specific location. |
| Pending Minutes | Minutes reserved against a balance for a PENDING PTO request, not yet deducted. |
| Available Minutes | `balanceMinutes - pendingMinutes`. Must never go negative. |
| Optimistic Lock | Version field on Balance and PTORequest; write fails with 409 if version has changed. |
| Idempotency Key | Client-supplied key scoped to an operation; replaying the same key returns the cached result. |
| Reconciliation | Periodic job that compares local balances to HCM and repairs drift. |
| Drift | A discrepancy between local `balanceMinutes` and HCM's authoritative balance. |
| HCM Snapshot | A point-in-time record of what HCM reported for a given employee+location balance. |
| Adjustment Event | An immutable ledger entry recording every change to a balance and its cause. |

---

## Glossary of Status Values

**PTORequest.status:** `PENDING` → `APPROVED` | `REJECTED` | `CANCELLED`

**ReconciliationRun.status:** `RUNNING` | `COMPLETED` | `FAILED`

**IdempotencyKey.status:** `IN_FLIGHT` | `COMPLETED` | `FAILED`

---

## Requirement 1: Employee Management

**User Story:** As a system administrator, I want to create and manage employee records so that ReadyOn knows which employees exist, who their managers are, and how to map them to HCM identities.

### Acceptance Criteria

1. WHEN a POST request is made to create an employee with a valid `hcmEmployeeId`, `name`, `email`, and optional `managerId`, THEN the system SHALL create the employee record and return it with HTTP 201.
2. WHEN a POST request is made with a duplicate `email` or `hcmEmployeeId`, THEN the system SHALL return HTTP 409 with a conflict error.
3. WHEN a POST request is made with a `managerId` that does not reference an existing employee, THEN the system SHALL return HTTP 422.
4. WHEN a GET request is made for a specific employee by ID, THEN the system SHALL return the employee record including `managerId` with HTTP 200, or HTTP 404 if not found.
5. WHEN a GET request is made to list all employees, THEN the system SHALL return a paginated response with `page`, `limit`, `total`, and `data` fields.
6. WHEN a PUT request is made to update an employee's `managerId`, THEN the system SHALL validate the new manager exists before persisting.
7. WHEN a GET request is made for an employee's direct reports, THEN the system SHALL return all employees whose `managerId` equals the given employee ID.

---

## Requirement 2: Location Management

**User Story:** As a system administrator, I want to manage location records so that PTO balances can be tracked per employee per location, respecting timezone differences.

### Acceptance Criteria

1. WHEN a POST request is made with a valid `code`, `name`, and `timezone`, THEN the system SHALL create the location and return HTTP 201.
2. WHEN a POST request is made with a duplicate `code`, THEN the system SHALL return HTTP 409.
3. WHEN a GET request is made for all locations, THEN the system SHALL return a paginated list.
4. WHEN a GET request is made for a specific location by ID, THEN the system SHALL return the location or HTTP 404.

---

## Requirement 3: Balance Read and Initialization

**User Story:** As an employee or manager, I want to view current PTO balances so that I can make informed decisions about time-off requests.

### Acceptance Criteria

1. WHEN a GET request is made for a specific employee's balance at a specific location, THEN the system SHALL return `balanceMinutes`, `pendingMinutes`, `availableMinutes` (computed), `version`, `hcmBalanceVersion`, and `lastSyncedAt`.
2. WHEN a GET request is made for all balances for an employee, THEN the system SHALL return a list of balance records across all locations.
3. WHEN a POST request is made to seed a balance for an employee+location pair that does not yet exist, THEN the system SHALL create it with the provided `balanceMinutes` and `pendingMinutes` defaulting to 0.
4. WHEN a POST request is made to seed a balance for an employee+location pair that already exists, THEN the system SHALL return HTTP 409.
5. WHEN a balance is read, THEN `availableMinutes` SHALL always equal `balanceMinutes - pendingMinutes` and SHALL never be negative.

---

## Requirement 4: PTO Request Submission

**User Story:** As an employee, I want to submit a PTO request so that my manager can review and approve or reject it.

### Acceptance Criteria

1. WHEN a POST request is made with a valid `employeeId`, `locationId`, `startDate`, `endDate`, `requestedMinutes`, and `Idempotency-Key` header, THEN the system SHALL create a PTO request in `PENDING` status and return HTTP 201.
2. WHEN the same `Idempotency-Key` is submitted again by the same employee, THEN the system SHALL return the original response with HTTP 200 without creating a duplicate record.
3. WHEN `requestedMinutes` exceeds `availableMinutes` for the employee+location balance, THEN the system SHALL return HTTP 422 with error code `INSUFFICIENT_BALANCE`.
4. WHEN a PTO request is successfully created, THEN the system SHALL atomically increment `pendingMinutes` on the balance by `requestedMinutes` using optimistic locking.
5. WHEN the optimistic lock check fails during pending reservation (balance version changed), THEN the system SHALL return HTTP 409 with error code `VERSION_CONFLICT` and the client SHOULD retry.
6. WHEN `startDate` is after `endDate`, THEN the system SHALL return HTTP 422.
7. WHEN `requestedMinutes` is zero or negative, THEN the system SHALL return HTTP 422.
8. WHEN a PTO request is created, THEN the system SHALL forward the request to HCM via `createPtoRequest` and store the returned `hcmRequestId` on the record.
9. WHEN HCM returns an error during PTO request forwarding, THEN the system SHALL still persist the local request in `PENDING` status and mark `hcmRequestId` as null, to be reconciled later.
10. WHEN a PTO request is created, THEN the system SHALL emit a `BalanceAdjustmentEvent` with `eventType: PENDING_RESERVED`.

---

## Requirement 5: Manager Approval and Rejection

**User Story:** As a manager, I want to approve or reject PTO requests from my direct reports so that employee time-off is properly authorized.

### Acceptance Criteria

1. WHEN a POST request is made to approve a PTO request, THEN the system SHALL verify that the `actionedById` is the `managerId` of the request's employee, returning HTTP 403 if not.
2. WHEN a manager approves a PENDING request, THEN the system SHALL atomically decrement both `pendingMinutes` and `balanceMinutes` by `requestedMinutes` using optimistic locking, and set status to `APPROVED`.
3. WHEN a manager rejects a PENDING request, THEN the system SHALL atomically decrement `pendingMinutes` by `requestedMinutes` (releasing the reservation) and set status to `REJECTED`.
4. WHEN an approval or rejection is attempted on a request that is not in `PENDING` status, THEN the system SHALL return HTTP 422 with error code `INVALID_STATUS_TRANSITION`.
5. WHEN the optimistic lock fails during approval or rejection, THEN the system SHALL return HTTP 409 and the client SHOULD retry.
6. WHEN a request is approved or rejected, THEN the system SHALL record `actionedAt`, `actionedById`, and optional `memo`.
7. WHEN a request is approved, THEN the system SHALL emit a `BalanceAdjustmentEvent` with `eventType: APPROVAL_COMMITTED`.
8. WHEN a request is rejected, THEN the system SHALL emit a `BalanceAdjustmentEvent` with `eventType: PENDING_RELEASED`.
9. WHEN a manager approves a request and `pendingMinutes` would go below zero after the operation, THEN the system SHALL return HTTP 422 with error code `BALANCE_INTEGRITY_VIOLATION`.

---

## Requirement 6: Employee Cancellation

**User Story:** As an employee, I want to cancel a pending PTO request so that my reserved balance is returned.

### Acceptance Criteria

1. WHEN an employee cancels their own PENDING request, THEN the system SHALL atomically decrement `pendingMinutes` by `requestedMinutes` and set status to `CANCELLED`.
2. WHEN a cancellation is attempted on a non-PENDING request, THEN the system SHALL return HTTP 422 with error code `INVALID_STATUS_TRANSITION`.
3. WHEN a cancellation is attempted by someone other than the request's employee, THEN the system SHALL return HTTP 403.
4. WHEN a request is cancelled, THEN the system SHALL emit a `BalanceAdjustmentEvent` with `eventType: PENDING_RELEASED`.

---

## Requirement 7: PTO Request Listing

**User Story:** As an employee or manager, I want to list PTO requests with filters so that I can review history and pending items.

### Acceptance Criteria

1. WHEN a GET request is made to list PTO requests, THEN the system SHALL support filtering by `employeeId`, `locationId`, `status`, `startDate` (range), and `endDate` (range).
2. WHEN listing PTO requests, THEN the system SHALL return a paginated response with `page`, `limit`, `total`, and `data`.
3. WHEN no filters are provided, THEN the system SHALL return all requests ordered by `requestedAt` descending.
4. WHEN `limit` exceeds 100, THEN the system SHALL cap it at 100 and return HTTP 200 with the capped result.

---

## Requirement 8: HCM Real-Time Balance Sync

**User Story:** As a system operator, I want to pull the current balance for a specific employee+location from HCM on demand so that stale local data can be corrected immediately.

### Acceptance Criteria

1. WHEN a POST request is made to sync a balance for a specific employee+location, THEN the system SHALL call HCM's `getBalance` API and overwrite the local `balanceMinutes` with the HCM value.
2. WHEN HCM returns a balance, THEN the system SHALL store a `HcmBalanceSnapshot` record with `source: REALTIME`.
3. WHEN HCM is unavailable during a sync request, THEN the system SHALL return HTTP 502 with error code `HCM_UNAVAILABLE` and leave the local balance unchanged.
4. WHEN a sync is performed, THEN the system SHALL update `lastSyncedAt` and `hcmBalanceVersion` on the balance record.
5. WHEN a sync is performed, THEN the system SHALL emit an `AuditEvent` with `action: HCM_BALANCE_SYNC`.

---

## Requirement 9: HCM Batch Sync

**User Story:** As a system operator, I want to trigger a batch sync of all balances from HCM so that the entire local dataset can be refreshed.

### Acceptance Criteria

1. WHEN a POST request is made to trigger a batch sync, THEN the system SHALL call HCM's `fetchBatchBalances` endpoint with optional `since` timestamp and paginate through all results.
2. WHEN batch sync completes, THEN the system SHALL update all local balances that differ from HCM values.
3. WHEN batch sync is triggered, THEN the system SHALL create a `ReconciliationRun` record with `runType: BATCH_SYNC` and track `inspectedRows`, `driftCount`, and `repairsApplied`.
4. WHEN HCM returns an error during batch sync, THEN the system SHALL mark the `ReconciliationRun` as `FAILED` and record `lastError`.
5. WHEN batch sync is already running, THEN a second trigger SHALL return HTTP 409 with error code `SYNC_ALREADY_RUNNING`.

---

## Requirement 10: HCM Webhook — Balance Update

**User Story:** As the HCM system, I want to push real-time balance updates to ReadyOn so that local balances stay current without polling.

### Acceptance Criteria

1. WHEN a POST request is received at `/webhooks/hcm/balance-update` with a valid payload, THEN the system SHALL update the local balance and return HTTP 200.
2. WHEN the same `externalEventId` is received again, THEN the system SHALL return HTTP 200 with `{ "duplicate": true }` without reprocessing.
3. WHEN the employee+location balance record does not exist locally, THEN the system SHALL return HTTP 404.
4. WHEN the webhook is processed, THEN the system SHALL store a `HcmBalanceSnapshot` with `source: REALTIME` and emit an `AuditEvent`.
5. WHEN the webhook payload fails validation (missing fields, invalid types), THEN the system SHALL return HTTP 422.

---

## Requirement 11: HCM Webhook — PTO Request Event

**User Story:** As the HCM system, I want to push PTO request status updates to ReadyOn so that local request records stay in sync with HCM decisions.

### Acceptance Criteria

1. WHEN a POST request is received at `/webhooks/hcm/pto-request-event` with a valid payload, THEN the system SHALL update the local PTO request's `hcmRequestId` and return HTTP 200.
2. WHEN the same `externalEventId` is received again, THEN the system SHALL return HTTP 200 with `{ "duplicate": true }`.
3. WHEN the referenced `ptoRequestId` does not exist, THEN the system SHALL return HTTP 404.
4. WHEN the event carries `status: APPROVED` or `status: REJECTED`, THEN the system SHALL apply the corresponding balance state machine transition if the local request is still `PENDING`.

---

## Requirement 12: Reconciliation Job

**User Story:** As a system operator, I want a scheduled reconciliation job to detect and repair drift between local balances and HCM so that eventual consistency is maintained automatically.

### Acceptance Criteria

1. WHEN the reconciliation job runs, THEN it SHALL fetch all balances from HCM via `fetchBatchBalances` and compare each to the local record.
2. WHEN drift is detected (local `balanceMinutes` ≠ HCM `balanceMinutes`), THEN the job SHALL overwrite the local value and increment `driftCount`.
3. WHEN a repair is applied, THEN the job SHALL emit a `BalanceAdjustmentEvent` with `eventType: RECONCILIATION_REPAIR` and an `AuditEvent`.
4. WHEN the job completes, THEN it SHALL update the `ReconciliationRun` record with `status: COMPLETED`, `completedAt`, `inspectedRows`, `driftCount`, and `repairsApplied`.
5. WHEN the job encounters an error for a specific row, THEN it SHALL log the error, increment `errorsCount`, and continue processing remaining rows.
6. WHEN the reconciliation job is triggered manually via API, THEN it SHALL behave identically to the scheduled run.
7. WHEN a reconciliation run is already in progress, THEN a new trigger SHALL return HTTP 409.

---

## Requirement 13: Reconciliation Run Observability

**User Story:** As a system operator, I want to query reconciliation run history so that I can audit drift patterns and repair effectiveness.

### Acceptance Criteria

1. WHEN a GET request is made to list reconciliation runs, THEN the system SHALL return a paginated list ordered by `startedAt` descending.
2. WHEN a GET request is made for a specific reconciliation run by ID, THEN the system SHALL return full details including `inspectedRows`, `driftCount`, `repairsApplied`, `errorsCount`, and `lastError`.
3. WHEN a reconciliation run is in `RUNNING` status, THEN the GET response SHALL reflect live progress counters.

---

## Requirement 14: Balance Adjustment Event History

**User Story:** As an auditor or operator, I want to view the full ledger of balance changes for an employee+location so that I can trace every debit, credit, and repair.

### Acceptance Criteria

1. WHEN a GET request is made for balance adjustment events for a specific balance, THEN the system SHALL return all events ordered by `createdAt` ascending.
2. WHEN a balance adjustment event is created, THEN it SHALL record `deltaMinutes`, `resultingBalanceMinutes`, `resultingPendingMinutes`, `source`, and optionally `externalEventId`.
3. WHEN replaying all adjustment events for a balance, THEN the final `resultingBalanceMinutes` SHALL equal the current `balanceMinutes` on the balance record.

---

## Requirement 15: Audit Event Log

**User Story:** As a compliance officer, I want to query the audit log for any entity so that I can reconstruct the history of all actions taken.

### Acceptance Criteria

1. WHEN a GET request is made for audit events for a specific entity (by `entityType` and `entityId`), THEN the system SHALL return all events ordered by `createdAt` ascending.
2. WHEN an audit event is created, THEN it SHALL include `entityType`, `entityId`, `action`, `payload`, `source`, and optional `correlationId`.
3. WHEN listing audit events, THEN the system SHALL support filtering by `entityType`, `action`, and date range.

---

## Non-Functional Requirements

### NFR-1: Balance Integrity
The invariant `balanceMinutes >= 0` and `pendingMinutes >= 0` and `balanceMinutes >= pendingMinutes` SHALL hold at all times. Any operation that would violate this invariant SHALL be rejected with HTTP 422.

### NFR-2: Idempotency
All PTO request submissions, HCM webhook events, and HCM sync triggers SHALL be idempotent. Replaying the same operation with the same idempotency key SHALL return the original result without side effects.

### NFR-3: Optimistic Concurrency
All balance mutations (reserve, commit, release, snapshot apply) SHALL use optimistic locking via the `version` field. A stale-version write SHALL return HTTP 409 and the caller SHALL retry.

### NFR-4: Eventual Consistency
The system SHALL tolerate temporary divergence between local balances and HCM. The reconciliation job SHALL converge the system to consistency within one reconciliation cycle.

### NFR-5: HCM Fault Tolerance
When HCM is unavailable, the system SHALL continue to serve read requests from local state. Write operations that require HCM SHALL fail gracefully with HTTP 502 and SHALL NOT corrupt local state.

### NFR-6: Observability
Every balance mutation SHALL produce a `BalanceAdjustmentEvent`. Every significant system action SHALL produce an `AuditEvent`. All events SHALL include a `correlationId` where available.

### NFR-7: Pagination
All list endpoints SHALL support `page` and `limit` query parameters. Default `limit` SHALL be 20. Maximum `limit` SHALL be 100.

### NFR-8: Time Representation
All timestamps SHALL be ISO 8601 UTC strings. All durations SHALL be in minutes (integer).

---

## Correctness Properties (for Property-Based Testing)

**P1 — Balance Non-Negativity:** For any sequence of PTO submissions, approvals, rejections, and HCM snapshots, `availableMinutes` (= `balanceMinutes - pendingMinutes`) SHALL never be negative.

**P2 — Pending Conservation:** The sum of `requestedMinutes` across all `PENDING` PTO requests for an employee+location SHALL always equal `pendingMinutes` on the balance record.

**P3 — Idempotency:** Submitting the same PTO request (same idempotency key) N times SHALL produce exactly one `PTORequest` record and exactly one `BalanceAdjustmentEvent`.

**P4 — Optimistic Lock Exclusion:** When N concurrent requests attempt to mutate the same balance at the same version, exactly one SHALL succeed and the rest SHALL receive HTTP 409.

**P5 — Ledger Replay Consistency:** Replaying all `BalanceAdjustmentEvent` records for a balance in order SHALL reproduce the current `balanceMinutes` and `pendingMinutes` exactly.

**P6 — Reconciliation Convergence:** After one full reconciliation run, for every employee+location, local `balanceMinutes` SHALL equal HCM `balanceMinutes` (modulo in-flight pending reservations).

**P7 — Status Transition Safety:** A `PTORequest` SHALL never transition from `APPROVED`, `REJECTED`, or `CANCELLED` to any other status.

**P8 — Webhook Deduplication:** Delivering the same HCM webhook event (same `externalEventId`) N times SHALL produce exactly one `HcmBalanceSnapshot` record and exactly one balance update.
