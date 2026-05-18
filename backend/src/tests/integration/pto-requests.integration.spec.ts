/**
 * INTEGRATION TESTS — PTO Request Flow
 *
 * Tests the full HTTP → Service → Prisma → SQLite stack.
 * Uses a real NestJS app with a real SQLite DB and a controllable mock HCM.
 */

import request = require('supertest');
import { createTestApp, resetDb, seedEmployee, seedLocation, seedBalance, TestApp } from './helpers/test-app';

describe('PTO Requests — integration', () => {
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

  // ── Submission ─────────────────────────────────────────────────────────────

  describe('POST /pto-requests', () => {
    it('creates a PENDING request and reserves balance', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-001')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-03T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.requestedMinutes).toBe(480);

      // Balance should have pendingMinutes incremented
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(480);
      expect(balance?.balanceMinutes).toBe(2400); // not deducted yet
    });

    it('returns 422 when requestedMinutes exceeds available balance', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 100, 0);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-002')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 200,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Insufficient/i);

      // Balance must be unchanged
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(0);
    });

    it('returns 400 when startDate is after endDate', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-003')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-05T00:00:00Z',
          endDate: '2026-06-01T00:00:00Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when idempotency key header is missing', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(400);
    });

    it('returns 404 when employee does not exist', async () => {
      const location = await seedLocation(testApp.prisma);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-004')
        .send({
          employeeId: 'nonexistent-emp',
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(404);
    });

    it('returns 404 when location does not exist', async () => {
      const employee = await seedEmployee(testApp.prisma);

      const res = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-005')
        .send({
          employeeId: employee.id,
          locationId: 'nonexistent-loc',
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(res.status).toBe(404);
    });

    it('creates audit event on successful submission', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'test-key-006')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      const audit = await testApp.prisma.auditEvent.findFirst({
        where: { entityType: 'PTO_REQUEST', action: 'CREATE' },
      });
      expect(audit).not.toBeNull();
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns same result and creates only one record on duplicate submission', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const payload = {
        employeeId: employee.id,
        locationId: location.id,
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-06-01T23:59:59Z',
        requestedMinutes: 480,
      };

      const res1 = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'dup-key-001')
        .send(payload);

      const res2 = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'dup-key-001')
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).toBe(res2.body.id);

      // Only one PTO request in DB
      const requests = await testApp.prisma.pTORequest.findMany({ where: { employeeId: employee.id } });
      expect(requests).toHaveLength(1);

      // Balance only reserved once
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(480);
    });
  });

  // ── Approval Flow ──────────────────────────────────────────────────────────

  describe('POST /pto-requests/:id/approve', () => {
    it('approves request, deducts balance, and records audit', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-A' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-A', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      // Submit first
      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'submit-key-001')
        .send({
          employeeId: employee.id,
          locationId: location.id,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-01T23:59:59Z',
          requestedMinutes: 480,
        });

      expect(submitRes.status).toBe(201);
      const reqId = submitRes.body.id;

      // Approve
      const approveRes = await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'approve-key-001')
        .send({ managerId: manager.id });

      expect(approveRes.status).toBe(201);
      expect(approveRes.body.status).toBe('APPROVED');

      // Balance: both balanceMinutes and pendingMinutes decremented
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(1920); // 2400 - 480
      expect(balance?.pendingMinutes).toBe(0);

      // Audit event
      const audit = await testApp.prisma.auditEvent.findFirst({
        where: { entityType: 'PTO_REQUEST', action: 'APPROVE' },
      });
      expect(audit).not.toBeNull();
    });

    it('returns 409 when approving an already-approved request', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-B' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-B', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'submit-key-002')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'approve-key-002')
        .send({ managerId: manager.id });

      // Second approval attempt
      const res2 = await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/approve`)
        .set('x-idempotency-key', 'approve-key-003') // different key
        .send({ managerId: manager.id });

      expect(res2.status).toBe(409);
    });
  });

  // ── Rejection Flow ─────────────────────────────────────────────────────────

  describe('POST /pto-requests/:id/reject', () => {
    it('rejects request and releases pending balance back to available', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-C' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-C', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'submit-key-003')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      const rejectRes = await request(testApp.app.getHttpServer())
        .post(`/pto-requests/${reqId}/reject`)
        .set('x-idempotency-key', 'reject-key-001')
        .send({ managerId: manager.id, reason: 'Team coverage needed' });

      expect(rejectRes.status).toBe(201);
      expect(rejectRes.body.status).toBe('REJECTED');

      // Balance: pendingMinutes released, balanceMinutes unchanged
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(0);
      expect(balance?.balanceMinutes).toBe(2400); // unchanged
    });
  });

  // ── HCM Webhook ────────────────────────────────────────────────────────────

  describe('POST /webhooks/hcm/balance-update', () => {
    it('updates local balance from HCM webhook and deduplicates', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const payload = {
        externalEventId: 'evt-001',
        employeeId: employee.id,
        locationId: location.id,
        balanceMinutes: 9999,
        hcmBalanceVersion: 'v5',
        asOf: new Date().toISOString(),
      };

      const res1 = await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/balance-update')
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body.duplicate).toBe(false);

      // Balance updated
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(9999);

      // Duplicate delivery
      const res2 = await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/balance-update')
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.duplicate).toBe(true);

      // Balance still 9999, not double-applied
      const balanceAfter = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balanceAfter?.balanceMinutes).toBe(9999);
    });

    it('returns 404 when balance record does not exist locally', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // No balance seeded

      const res = await request(testApp.app.getHttpServer())
        .post('/webhooks/hcm/balance-update')
        .send({
          externalEventId: 'evt-002',
          employeeId: employee.id,
          locationId: location.id,
          balanceMinutes: 1000,
          hcmBalanceVersion: 'v1',
          asOf: new Date().toISOString(),
        });

      expect(res.status).toBe(404);
    });
  });
});
