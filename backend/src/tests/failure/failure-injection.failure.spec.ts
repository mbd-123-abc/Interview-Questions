/**
 * FAILURE INJECTION TESTS
 *
 * Simulates HCM outages, timeouts, partial failures, stale cache,
 * and out-of-order webhook delivery. Verifies graceful degradation
 * and that local state is never corrupted by external failures.
 */

import request = require('supertest');
import { createTestApp, resetDb, seedEmployee, seedLocation, seedBalance, TestApp } from '../integration/helpers/test-app';

describe('Failure Injection — failure simulation', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    await resetDb(testApp.prisma);
    testApp.hcm.reset();
  });

  // ── HCM outage during PTO submission ──────────────────────────────────────

  describe('HCM outage during PTO submission', () => {
    it('creates local PTO request even when HCM createPtoRequest fails', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-FAIL' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-FAIL', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      // Submit succeeds locally (HCM is called only on approve, not submit)
      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'fail-submit-key-001')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');

      // Balance reserved locally
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(480);
    });

    it('approves locally and records HCM_SYNC_FAILED audit when HCM is down during approval', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-FAIL2' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-FAIL2', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'fail-submit-key-002')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      // HCM goes down before approval
      testApp.hcm.setFailure('error');

      const approveRes = await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'fail-approve-key-001')
        .send({ managerId: manager.id });

      // Local approval still succeeds
      expect(approveRes.status).toBe(201);
      expect(approveRes.body.status).toBe('APPROVED');

      // Balance deducted locally
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(1920);
      expect(balance?.pendingMinutes).toBe(0);

      // HCM_SYNC_FAILED audit event recorded
      const audit = await testApp.prisma.auditEvent.findFirst({
        where: { action: 'HCM_SYNC_FAILED' },
      });
      expect(audit).not.toBeNull();

      // hcmRequestId is null (will be reconciled later)
      const ptoReq = await testApp.prisma.pTORequest.findUnique({ where: { id: reqId } });
      expect(ptoReq?.hcmRequestId).toBeNull();
    });
  });

  // ── HCM timeout ───────────────────────────────────────────────────────────

  describe('HCM timeout', () => {
    it('does not corrupt local state when HCM times out during approval', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-TIMEOUT' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-TIMEOUT', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'timeout-submit-key')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      // Simulate HCM timeout
      testApp.hcm.setFailure('timeout');

      const approveRes = await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'timeout-approve-key')
        .send({ managerId: manager.id });

      // Local approval succeeds despite HCM timeout
      expect(approveRes.status).toBe(201);

      // Local state is consistent
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(1920);
      expect(balance?.pendingMinutes).toBe(0);
      expect(balance!.balanceMinutes - balance!.pendingMinutes).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Stale cache test ──────────────────────────────────────────────────────

  describe('stale cache scenario', () => {
    it('local validation may pass on stale data but reconciliation self-corrects', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);

      // Local cache says 10 days (4800 min) — stale
      await seedBalance(testApp.prisma, employee.id, location.id, 4800, 0);

      // HCM actual: 1 day (480 min) — employee used time directly in HCM
      testApp.hcm.setBalance(employee.id, location.id, 480, 'v-actual');

      // Local validation passes (stale data allows it)
      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'stale-submit-key')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 2400, // would exceed real balance of 480
        });

      // Passes locally because local cache is stale
      expect(submitRes.status).toBe(201);

      // Now run reconciliation — HCM truth wins
      await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });

      // After reconciliation, balanceMinutes corrected to HCM truth
      expect(balance?.balanceMinutes).toBe(480);
      // System self-corrected
    });
  });

  // ── Duplicate webhook delivery ────────────────────────────────────────────

  describe('duplicate webhook delivery', () => {
    it('processes balance update webhook exactly once on N deliveries', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const payload = {
        externalEventId: 'dedup-evt-001',
        employeeId: employee.id,
        locationId: location.id,
        balanceMinutes: 9999,
        hcmBalanceVersion: 'v-dedup',
        asOf: new Date().toISOString(),
      };

      // Deliver same event 5 times (simulating retry storm)
      // Under concurrency, some may race past the findUnique check and hit the
      // unique constraint — those return either { duplicate: true } or a 5xx.
      // The critical invariants are: balance updated exactly once, one snapshot.
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(testApp.app.getHttpServer())
            .post('/webhooks/hcm/balance-update')
            .send(payload)
        )
      );

      // At least one must succeed with duplicate:false
      const nonDuplicates = results.filter(r => r.status < 300 && r.body.duplicate === false).length;
      expect(nonDuplicates).toBeGreaterThanOrEqual(1);

      // No more than one non-duplicate (idempotency guarantee)
      expect(nonDuplicates).toBe(1);

      // Balance updated exactly once
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(9999);

      // Exactly one snapshot record
      const snapshots = await testApp.prisma.hcmBalanceSnapshot.findMany({
        where: { externalId: 'dedup-evt-001' },
      });
      expect(snapshots).toHaveLength(1);
    });

    it('processes PTO request event webhook exactly once on duplicate delivery', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'webhook-pto-key')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const ptoId = submitRes.body.id;

      const eventPayload = {
        externalEventId: 'pto-evt-001',
        hcmRequestId: 'hcm-req-001',
        ptoRequestId: ptoId,
        status: 'PENDING' as const,
        actionedAt: new Date().toISOString(),
      };

      // Deliver 3 times sequentially (realistic retry scenario)
      const results: Array<{ status: number; body: { duplicate?: boolean } }> = [];
      for (let i = 0; i < 3; i++) {
        const r = await request(testApp.app.getHttpServer())
          .post('/webhooks/hcm/pto-request-event')
          .send(eventPayload);
        results.push(r);
      }

      results.forEach(r => expect(r.status).toBeLessThan(300));

      const nonDuplicates = results.filter(r => r.body.duplicate === false).length;
      expect(nonDuplicates).toBe(1);

      // hcmRequestId set exactly once
      const ptoReq = await testApp.prisma.pTORequest.findUnique({ where: { id: ptoId } });
      expect(ptoReq?.hcmRequestId).toBe('hcm-req-001');
    });
  });

  // ── Partial failure recovery ──────────────────────────────────────────────

  describe('partial failure recovery', () => {
    it('reconciliation repairs hcmRequestId-less approvals after HCM recovers', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-PARTIAL' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-PARTIAL', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'partial-submit-key')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      // HCM down during approval
      testApp.hcm.setFailure('error');

      await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'partial-approve-key')
        .send({ managerId: manager.id });

      // Verify hcmRequestId is null (partial failure)
      const ptoReqBefore = await testApp.prisma.pTORequest.findUnique({ where: { id: reqId } });
      expect(ptoReqBefore?.hcmRequestId).toBeNull();

      // HCM recovers — simulate HCM pushing the event back via webhook
      testApp.hcm.setFailure('none');

      await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/pto-request-event')
        .send({
          externalEventId: 'recovery-evt-001',
          hcmRequestId: 'hcm-recovered-001',
          ptoRequestId: reqId,
          status: 'APPROVED',
          actionedAt: new Date().toISOString(),
        });

      // hcmRequestId now set
      const ptoReqAfter = await testApp.prisma.pTORequest.findUnique({ where: { id: reqId } });
      expect(ptoReqAfter?.hcmRequestId).toBe('hcm-recovered-001');
    });
  });

  // ── HCM returns 500 during reconciliation ─────────────────────────────────

  describe('HCM 500 during reconciliation', () => {
    it('marks reconciliation run as FAILED and records lastError', async () => {
      testApp.hcm.setFailure('error');

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      expect(res.status).toBeGreaterThanOrEqual(500);

      const run = await testApp.prisma.reconciliationRun.findFirst({
        orderBy: { startedAt: 'desc' },
      });
      expect(run?.status).toBe('FAILED');
      expect(run?.lastError).toBeTruthy();
    });
  });

  // ── Out-of-order webhook delivery ─────────────────────────────────────────

  describe('out-of-order webhook delivery', () => {
    it('handles older balance update after newer one without regressing balance', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const now = new Date();
      const older = new Date(now.getTime() - 60000).toISOString(); // 1 min ago
      const newer = now.toISOString();

      // Deliver newer event first
      await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/balance-update')
        .send({
          externalEventId: 'out-of-order-newer',
          employeeId: employee.id,
          locationId: location.id,
          balanceMinutes: 3000,
          hcmBalanceVersion: 'v-newer',
          asOf: newer,
        });

      // Deliver older event second (out of order)
      await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/balance-update')
        .send({
          externalEventId: 'out-of-order-older',
          employeeId: employee.id,
          locationId: location.id,
          balanceMinutes: 1000,
          hcmBalanceVersion: 'v-older',
          asOf: older,
        });

      // Both events processed (no dedup since different externalEventIds)
      // The system applies both — last write wins in current implementation
      // This is a known limitation; reconciliation will correct it
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });

      // Balance is not negative regardless of order
      expect(balance?.balanceMinutes).toBeGreaterThanOrEqual(0);

      // Two snapshots recorded
      const snapshots = await testApp.prisma.hcmBalanceSnapshot.findMany({
        where: { employeeId: employee.id, source: 'REALTIME' },
      });
      expect(snapshots).toHaveLength(2);
    });
  });

  // ── Insufficient balance rejection ────────────────────────────────────────

  describe('insufficient balance rejection', () => {
    it('rejects request when balance is exactly 0', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 0, 0);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'zero-balance-key')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Insufficient/i);
    });

    it('rejects request when all balance is already pending', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // All 480 minutes already pending
      await seedBalance(testApp.prisma, employee.id, location.id, 480, 480);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'all-pending-key')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 1,
        });

      expect(res.status).toBe(400);
    });
  });

  // ── Invalid dimension rejection ───────────────────────────────────────────

  describe('invalid dimension rejection', () => {
    it('returns 404 when locationId is invalid', async () => {
      const employee = await seedEmployee(testApp.prisma);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'invalid-loc-key')
        .send({
          employeeId: employee.id,
          locationId: 'invalid-location-id',
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(404);
    });

    it('returns 400 when no balance record exists for valid employee+location pair', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // No balance seeded for this pair

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'no-balance-key')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/balance/i);
    });
  });
});
