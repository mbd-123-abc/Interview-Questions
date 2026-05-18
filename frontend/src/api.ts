const BASE = '';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? res.statusText);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  hcmEmployeeId: string;
  name: string;
  email: string;
  managerId: string | null;
}

export interface Location {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export interface Balance {
  id: string;
  employeeId: string;
  locationId: string;
  balanceMinutes: number;
  pendingMinutes: number;
  version: number;
  lastSyncedAt: string | null;
}

export interface PtoRequest {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  requestedMinutes: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  memo: string | null;
  hcmRequestId: string | null;
  requestedAt: string;
  actionedAt: string | null;
  actionedById: string | null;
}

export interface ReconciliationResult {
  runId: string;
  status: string;
  inspectedRows: number;
  driftCount: number;
  repairsApplied: number;
  errorsCount: number;
}

// ── Employees ────────────────────────────────────────────────────────────────

export const getEmployees = () => req<Employee[]>('GET', '/employees');

export const createEmployee = (data: { hcmEmployeeId: string; name: string; email: string; managerId?: string }) =>
  req<Employee>('POST', '/employees', data);

export const updateEmployee = (id: string, data: { managerId?: string; name?: string }) =>
  req<Employee>('PUT', `/employees/${id}`, data);

// ── Locations ────────────────────────────────────────────────────────────────

export const getLocations = () => req<Location[]>('GET', '/locations');

export const createLocation = (data: { code: string; name: string; timezone: string }) =>
  req<Location>('POST', '/locations', data);

// ── Balances ─────────────────────────────────────────────────────────────────

export const getBalancesForEmployee = (employeeId: string) =>
  req<Balance[]>('GET', `/balances/employee/${employeeId}`);

export const createBalance = (data: { employeeId: string; locationId: string; balanceMinutes: number }) =>
  req<Balance>('POST', '/balances', data);

// ── PTO Requests ─────────────────────────────────────────────────────────────

export const getPtoRequestsForEmployee = (employeeId: string) =>
  req<PtoRequest[]>('GET', `/pto-requests/employee/${employeeId}`);

export const createPtoRequest = (
  data: { employeeId: string; locationId: string; startDate: string; endDate: string; requestedMinutes: number; memo?: string },
  idempotencyKey: string,
) =>
  fetch(`${BASE}/pto-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idempotencyKey },
    body: JSON.stringify(data),
  }).then(async (res) => {
    if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
    return res.json() as Promise<PtoRequest>;
  });

export const approvePtoRequest = (id: string, managerId: string, idempotencyKey: string) =>
  fetch(`${BASE}/pto-requests/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idempotencyKey },
    body: JSON.stringify({ managerId }),
  }).then(async (res) => {
    if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
    return res.json() as Promise<PtoRequest>;
  });

export const rejectPtoRequest = (id: string, managerId: string, reason: string, idempotencyKey: string) =>
  fetch(`${BASE}/pto-requests/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idempotencyKey },
    body: JSON.stringify({ managerId, reason }),
  }).then(async (res) => {
    if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message); }
    return res.json() as Promise<PtoRequest>;
  });

// ── Reconciliation ───────────────────────────────────────────────────────────

export const runReconciliation = () =>
  req<ReconciliationResult>('POST', '/reconciliation/run', {});

// ── Helpers ──────────────────────────────────────────────────────────────────

export const minutesToHours = (m: number) => (m / 60).toFixed(1);

export const nanoid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
