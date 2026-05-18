/**
 * RECONCILIATION / SYNC TESTS
 *
 * Tests the full reconciliation pipeline: drift detection, repair,
 * missing records, stale data correction, and batch sync overwrite.
 * Uses real NestJS + SQLite + controllable mock HCM.
 */

import request = require('supertest');
import { createTestApp, resetDb, seedEmployee, seedLocation, seedBalance, TestApp } from '../integration/helpers/test-app';

describe('Reconciliation — sync', () => {
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

  // ── Anniversary bonus simulation ──────────────────────────────────────────

  describe('anniversary bonus simulation', () => {
    it('heals local balance when HCM independently adds anniversary bonus', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);

      // Local: 8 days = 3840 minutes
      await seedBalance(testApp.prisma, employee.id, location.id, 3840, 0);

      // HCM independently grants anniversary bonus: 13 days = 6240 minutes
      testApp.hcm.setBalance(employee.id, location.id, 6240, 'v-anniversary');

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({ fullSnapshot: false });

      expect(res.status).toBe(201);
      expect(res.body.driftCount).toBe(1);
      expect(res.body.repairsApplied).toBe(1);

      // Local balance now matches HCM
      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(6240);
    });
  });

  // ── Missing record ────────────────────────────────────────────────────────

  describe('missing local record', () => {
    it('creates local balance when HCM has record but local DB does not', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      // No local balance seeded

      testApp.hcm.setBalance(employee.id, location.id, 1200, 'v1');

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.repairsApplied).toBe(1);

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance).not.toBeNull();
      expect(balance?.balanceMinutes).toBe(1200);
    });
  });

  // ── Stale local data ──────────────────────────────────────────────────────

  describe('stale local data correction', () => {
    it('overwrites stale local balance with HCM truth', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);

      // Local is stale: 500 minutes
      await seedBalance(testApp.prisma, employee.id, location.id, 500, 0);

      // HCM truth: 2400 minutes
      testApp.hcm.setBalance(employee.id, location.id, 2400, 'v-fresh');

      await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      expect(balance?.balanceMinutes).toBe(2400);
    });

    it('creates audit event for each drift repair', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 100, 0);
      testApp.hcm.setBalance(employee.id, location.id, 9999, 'v2');

      await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      const audit = await testApp.prisma.auditEvent.findFirst({
        where: { action: 'RECONCILIATION_ADJUSTMENT' },
      });
      expect(audit).not.toBeNull();
      const payload = JSON.parse(audit!.payload);
      expect(payload.localBalanceMinutes).toBe(100);
      expect(payload.hcmBalanceMinutes).toBe(9999);
    });
  });

  // ── No drift ──────────────────────────────────────────────────────────────

  describe('no drift scenario', () => {
    it('reports zero drift when local matches HCM', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);
      testApp.hcm.setBalance(employee.id, location.id, 2400, 'v1');

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      expect(res.body.driftCount).toBe(0);
      expect(res.body.repairsApplied).toBe(0);
      expect(res.body.inspectedRows).toBe(1);
    });
  });

  // ── Multiple employees ────────────────────────────────────────────────────

  describe('multiple employees', () => {
    it('reconciles all employees in a single run', async () => {
      const location = await seedLocation(testApp.prisma);
      const employees = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          seedEmployee(testApp.prisma, { hcmEmployeeId: `HCM-MULTI-${i}` })
        )
      );

      // Seed local balances at 1000, HCM at 2000 for all
      for (const emp of employees) {
        await seedBalance(testApp.prisma, emp.id, location.id, 1000, 0);
        testApp.hcm.setBalance(emp.id, location.id, 2000, 'v-updated');
      }

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      expect(res.body.inspectedRows).toBe(5);
      expect(res.body.driftCount).toBe(5);
      expect(res.body.repairsApplied).toBe(5);

      // All local balances updated
      for (const emp of employees) {
        const balance = await testApp.prisma.balance.findUnique({
          where: { employeeId_locationId: { employeeId: emp.id, locationId: location.id } },
        });
        expect(balance?.balanceMinutes).toBe(2000);
      }
    });
  });

  // ── ReconciliationRun record ──────────────────────────────────────────────

  describe('ReconciliationRun tracking', () => {
    it('creates a ReconciliationRun record with COMPLETED status', async () => {
      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      expect(res.body.runId).toBeDefined();
      expect(res.body.status).toBe('COMPLETED');

      const run = await testApp.prisma.reconciliationRun.findUnique({
        where: { id: res.body.runId },
      });
      expect(run?.status).toBe('COMPLETED');
      expect(run?.completedAt).not.toBeNull();
    });

    it('marks run as FAILED when HCM is unavailable', async () => {
      testApp.hcm.setFailure('error');

      const res = await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      // The endpoint should return an error status
      expect(res.status).toBeGreaterThanOrEqual(500);

      const run = await testApp.prisma.reconciliationRun.findFirst({
        orderBy: { startedAt: 'desc' },
      });
      expect(run?.status).toBe('FAILED');
      expect(run?.lastError).toBeTruthy();
    });
  });

  // ── Batch sync overwrites stale cache ─────────────────────────────────────

  describe('batch sync overwrite (stale cache test)', () => {
    it('corrects local balance that was stale due to missed webhook', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);

      // Simulate: local cache is stale at 10 days (4800 min)
      // HCM actual: 1 day (480 min) — employee used time directly in HCM
      await seedBalance(testApp.prisma, employee.id, location.id, 4800, 0);
      testApp.hcm.setBalance(employee.id, location.id, 480, 'v-corrected');

      await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      const balance = await testApp.prisma.balance.findUnique({
        where: { employeeId_locationId: { employeeId: employee.id, locationId: location.id } },
      });
      // Local corrected to HCM truth
      expect(balance?.balanceMinutes).toBe(480);
    });
  });

  // ── HCM snapshot records ──────────────────────────────────────────────────

  describe('HCM snapshot recording', () => {
    it('creates HcmBalanceSnapshot records during reconciliation', async () => {
      const employee = await seedEmployee(testApp.prisma);
      const location = await seedLocation(testApp.prisma);
      await seedBalance(testApp.prisma, employee.id, location.id, 2400, 0);
      testApp.hcm.setBalance(employee.id, location.id, 3000, 'v2');

      await request(testApp.app.getHttpServer())
        .post('/reconciliation/run')
        .send({});

      const snapshots = await testApp.prisma.hcmBalanceSnapshot.findMany({
        where: { employeeId: employee.id, source: 'BATCH' },
      });
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
      expect(snapshots[0].hcmBalanceMinutes).toBe(3000);
    });
  });
});
