/**
 * CONCURRENCY / RACE CONDITION TESTS
 *
 * These tests fire parallel HTTP requests against a real NestJS + SQLite app
 * and assert that optimistic locking prevents double-spend and negative balances.
 *
 * Run with --runInBand to avoid cross-test DB interference.
 */

import request = require('supertest');
import { createTestApp, resetDb, seedEmployee, seedLocation, seedBalance, TestApp } from '../integration/helpers/test-app';

describe('Race Conditions — concurrency', () => {
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

  // ── Core invariant: balance never goes negative ───────────────────────────

  describe('concurrent PTO submissions — balance integrity', () => {
    it('allows only one of two concurrent requests when balance covers only one', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // Balance = 480 minutes. Two requests each want 480. Only one can succeed.
      await seedBalance(testApp.prisma, employee.id, location.id, 480, 0);

      const makeRequest = (key: string) =>
        request(testApp.app.getHttpServer())
          .post('/pto-requests')
          .set('x-idempotency-key', key)
          .send({
            employeeId: employee.id,
            locationId: location.id,
            startDate: '2026-06-01T00:00:00Z',
            endDate: '2026-06-01T23:59:59Z',
            requestedMinutes: 480,
          });

      const [res1, res2] = await Promise.all([
        makeRequest('concurrent-key-A'),
        makeRequest('concurrent-key-B'),
      ]);

      const statuses = [res1.status, res2.status];
      const successes = statuses.filter(s => s === 201).length;
      const failures = statuses.filter(s => s === 400 || s === 409).length;

      // Exactly one succeeds, one fails
      expect(successes).toBe(1);
      expect(failures).toBe(1);

      // DB: only one PTO request created
      const ptoRequests = await testApp.prisma.pTORequest.findMany({ where: { employeeId: employee.id } });
      expect(ptoRequests).toHaveLength(1);

      // Balance: pendingMinutes = 480, never 960
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(480);
      expect(balance?.balanceMinutes).toBe(480);
      // Available = 0, never negative
      expect(balance!.balanceMinutes - balance!.pendingMinutes).toBeGreaterThanOrEqual(0);
    });

    it('never produces negative available balance under 5 concurrent requests', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // Balance = 960 minutes. 5 requests each want 480. At most 2 can succeed.
      await seedBalance(testApp.prisma, employee.id, location.id, 960, 0);

      const requests = Array.from({ length: 5 }, (_, i) =>
        request(testApp.app.getHttpServer())
          .post('/pto-requests')
          .set('x-idempotency-key', `stress-key-${i}`)
          .send({
            employeeId: employee.id,
            locationId: location.id,
            startDate: '2026-06-01T00:00:00Z',
            endDate: '2026-06-01T23:59:59Z',
            requestedMinutes: 480,
          })
      );

      const results = await Promise.all(requests);
      const successes = results.filter(r => r.status === 201).length;

      // At most 2 can succeed (960 / 480 = 2)
      expect(successes).toBeLessThanOrEqual(2);

      // Critical invariant: available balance never negative
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      const available = balance!.balanceMinutes - balance!.pendingMinutes;
      expect(available).toBeGreaterThanOrEqual(0);
    });

    it('all concurrent requests succeed when balance is sufficient for all', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // Balance = 2400. 3 requests each want 480. All should succeed.
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const results = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          request(testApp.app.getHttpServer())
            .post('/pto-requests')
            .set('x-idempotency-key', `all-succeed-key-${i}`)
            .send({
              employeeId: employee.id,
              locationId: location.id,
              startDate: `2026-06-0${i + 1}T00:00:00Z`,
              endDate: `2026-06-0${i + 1}T23:59:59Z`,
              requestedMinutes: 480,
            })
        )
      );

      const successes = results.filter(r => r.status === 201).length;
      expect(successes).toBe(3);

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(1440); // 3 × 480
      expect(balance!.balanceMinutes - balance!.pendingMinutes).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Optimistic locking ────────────────────────────────────────────────────

  describe('optimistic locking', () => {
    it('returns 409 when two approvals race on the same request', async () => {
      const manager = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-MGR-RACE' });
      const employee = await seedEmployee(testApp.prisma, { hcmEmployeeId: 'HCM-EMP-RACE', managerId: manager.id });
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);

      const submitRes = await request(testApp.app.getHttpServer())
        .post('/pto-requests')
        .set('x-idempotency-key', 'race-submit-key')
        .send({ employeeId: employee.id, locationId: location.id, startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-01T23:59:59Z', requestedMinutes: 480 });

      const reqId = submitRes.body.id;

      // Two managers race to approve the same request
      const [approveRes1, approveRes2] = await Promise.all([
        request(testApp.app.getHttpServer())
          .post(`/pto-requests/${reqId}/approve`)
          .set('x-idempotency-key', 'race-approve-key-1')
          .send({ managerId: manager.id }),
        request(testApp.app.getHttpServer())
          .post(`/pto-requests/${reqId}/approve`)
          .set('x-idempotency-key', 'race-approve-key-2')
          .send({ managerId: manager.id }),
      ]);

      const statuses = [approveRes1.status, approveRes2.status];
      // One succeeds (201), one conflicts (409)
      expect(statuses).toContain(201);
      expect(statuses.filter(s => s === 409 || s === 400).length).toBeGreaterThanOrEqual(1);

      // Balance deducted exactly once
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(1920); // 2400 - 480, not 1440
    });
  });

  // ── Duplicate retry (idempotency under concurrency) ───────────────────────

  describe('duplicate retry under concurrency', () => {
    it('creates exactly one record when same idempotency key is sent concurrently', async () => {
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

      // Fire 5 identical requests with the same idempotency key simultaneously
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(testApp.app.getHttpServer())
            .post('/pto-requests')
            .set('x-idempotency-key', 'concurrent-dup-key')
            .send(payload)
        )
      );

      // All should return 2xx (either 201 first time or 200/201 cached)
      // Under true concurrency, some may get 409 PENDING — that's correct behavior
      // The key invariant is: only one record created and all successful responses share the same ID
      const successful = results.filter(r => r.status < 300);
      const conflicted = results.filter(r => r.status === 409);

      // At least one must succeed
      expect(successful.length).toBeGreaterThanOrEqual(1);
      // Conflicts are acceptable under concurrency (PENDING state)
      expect(successful.length + conflicted.length).toBe(5);

      // All successful responses return the same request ID
      const ids = successful.map(r => r.body.id);
      expect(new Set(ids).size).toBe(1);

      // Only one PTO request in DB
      const ptoRequests = await testApp.prisma.pTORequest.findMany({ where: { employeeId: employee.id } });
      expect(ptoRequests).toHaveLength(1);

      // Balance reserved exactly once
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.pendingMinutes).toBe(480);
    });
  });

  // ── Pending conservation property ─────────────────────────────────────────

  describe('pending conservation invariant', () => {
    it('sum of PENDING requestedMinutes always equals pendingMinutes on balance', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 4800, 0);

      // Submit 5 requests of 480 each (total 2400, balance has 4800)
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(testApp.app.getHttpServer())
            .post('/pto-requests')
            .set('x-idempotency-key', `conservation-key-${i}`)
            .send({
              employeeId: employee.id,
              locationId: location.id,
              startDate: `2026-06-0${i + 1}T00:00:00Z`,
              endDate: `2026-06-0${i + 1}T23:59:59Z`,
              requestedMinutes: 480,
            })
        )
      );

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });

      const pendingRequests = await testApp.prisma.pTORequest.findMany({
        where: { employeeId: employee.id, status: 'PENDING' },
      });

      const sumOfPendingRequests = pendingRequests.reduce((sum, r) => sum + r.requestedMinutes, 0);
      expect(balance?.pendingMinutes).toBe(sumOfPendingRequests);
    });
  });
});
