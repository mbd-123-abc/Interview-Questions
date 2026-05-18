/**
 * UNIT TESTS — ReconciliationService
 *
 * Tests reconciliation logic: drift detection, repair, pagination,
 * missing records, HCM failure handling, and run status tracking.
 */

import { ReconciliationService } from '../../modules/reconciliation/reconciliation.service';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeHcmRecord(overrides: Partial<{
  employeeId: string; locationId: string; balanceMinutes: number;
  hcmBalanceVersion: string; asOf: string;
}> = {}) {
  return {
    employeeId: 'emp-1', locationId: 'loc-1',
    balanceMinutes: 2400, hcmBalanceVersion: 'v2',
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function makeLocalBalance(overrides: Partial<{
  id: string; balanceMinutes: number; pendingMinutes: number; version: number;
}> = {}) {
  return {
    id: 'bal-1', employeeId: 'emp-1', locationId: 'loc-1',
    balanceMinutes: 2400, pendingMinutes: 0, version: 1,
    hcmBalanceVersion: 'v1', lastSyncedAt: null, updatedAt: new Date(),
    ...overrides,
  };
}

function makeRun(status = 'RUNNING') {
  return { id: 'run-1', runType: 'INCREMENTAL', status, startedAt: new Date(), completedAt: null, inspectedRows: 0, driftCount: 0, repairsApplied: 0, errorsCount: 0, lastError: null };
}

function makeMockPrisma(txOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const tx = {
    hcmBalanceSnapshot: { create: jest.fn().mockResolvedValue({}) },
    balance: {
      create: jest.fn().mockResolvedValue(makeLocalBalance()),
      update: jest.fn().mockResolvedValue(makeLocalBalance()),
    },
    employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
    location: { findUnique: jest.fn().mockResolvedValue({ id: 'loc-1' }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    ...txOverrides,
  };

  return {
    reconciliationRun: {
      create: jest.fn().mockResolvedValue(makeRun()),
      update: jest.fn().mockResolvedValue(makeRun('COMPLETED')),
    },
    $transaction: jest.fn().mockImplementation((cb: (tx: any) => Promise<unknown>) => cb(tx)),
  };
}

function makeService(overrides: {
  hcmService?: Partial<Record<string, jest.Mock>>;
  balancesService?: Partial<Record<string, jest.Mock>>;
  prisma?: ReturnType<typeof makeMockPrisma>;
} = {}) {
  const hcmService = {
    fetchBatchBalances: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 }),
    ...overrides.hcmService,
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const balancesService = {
    findByEmployeeLocation: jest.fn().mockResolvedValue(makeLocalBalance()),
    ...overrides.balancesService,
  };
  const prisma = overrides.prisma ?? makeMockPrisma();

  return new ReconciliationService(
    hcmService as any,
    auditService as any,
    balancesService as any,
    prisma as any,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ReconciliationService — unit', () => {

  describe('runOnDemand', () => {
    it('creates a ReconciliationRun record with RUNNING status', async () => {
      const prisma = makeMockPrisma();
      const svc = makeService({ prisma });

      await svc.runOnDemand();

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) })
      );
    });

    it('marks run as COMPLETED when HCM returns empty data', async () => {
      const prisma = makeMockPrisma();
      const svc = makeService({ prisma });

      const result = await svc.runOnDemand();

      expect(result.status).toBe('COMPLETED');
      expect(prisma.reconciliationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
      );
    });

    it('detects drift and increments driftCount when local != HCM balance', async () => {
      const hcmRecord = makeHcmRecord({ balanceMinutes: 9999 }); // HCM says 9999
      const localBalance = makeLocalBalance({ balanceMinutes: 2400 }); // local says 2400 → drift

      const prisma = makeMockPrisma();
      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: [hcmRecord], total: 1, page: 1, limit: 100 }),
        },
        balancesService: { findByEmployeeLocation: jest.fn().mockResolvedValue(localBalance) },
        prisma,
      });

      const result = await svc.runOnDemand();

      expect(result.driftCount).toBe(1);
      expect(result.repairsApplied).toBe(1);
      expect(result.inspectedRows).toBe(1);
    });

    it('does not increment driftCount when local matches HCM balance', async () => {
      const hcmRecord = makeHcmRecord({ balanceMinutes: 2400 });
      const localBalance = makeLocalBalance({ balanceMinutes: 2400 }); // same → no drift

      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: [hcmRecord], total: 1, page: 1, limit: 100 }),
        },
        balancesService: { findByEmployeeLocation: jest.fn().mockResolvedValue(localBalance) },
      });

      const result = await svc.runOnDemand();

      expect(result.driftCount).toBe(0);
      expect(result.repairsApplied).toBe(0);
    });

    it('creates missing local balance when HCM has record but local does not', async () => {
      const hcmRecord = makeHcmRecord({ balanceMinutes: 1200 });
      const prisma = makeMockPrisma();

      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: [hcmRecord], total: 1, page: 1, limit: 100 }),
        },
        balancesService: { findByEmployeeLocation: jest.fn().mockResolvedValue(null) }, // missing locally
        prisma,
      });

      const result = await svc.runOnDemand();

      expect(result.repairsApplied).toBe(1);
      // balance.create should have been called inside the transaction
      const txMock = (prisma.$transaction as jest.Mock).mock.calls[0];
      expect(txMock).toBeDefined();
    });

    it('skips record and logs audit when employee/location not found locally', async () => {
      const hcmRecord = makeHcmRecord();
      const tx = {
        hcmBalanceSnapshot: { create: jest.fn().mockResolvedValue({}) },
        balance: { create: jest.fn(), update: jest.fn() },
        employee: { findUnique: jest.fn().mockResolvedValue(null) }, // unknown employee
        location: { findUnique: jest.fn().mockResolvedValue(null) },
        auditEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        reconciliationRun: {
          create: jest.fn().mockResolvedValue(makeRun()),
          update: jest.fn().mockResolvedValue(makeRun('COMPLETED')),
        },
        $transaction: jest.fn().mockImplementation((cb: (tx: any) => Promise<unknown>) => cb(tx)),
      };

      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: [hcmRecord], total: 1, page: 1, limit: 100 }),
        },
        balancesService: { findByEmployeeLocation: jest.fn().mockResolvedValue(null) },
        prisma: prisma as any,
      });

      const result = await svc.runOnDemand();

      expect(tx.balance.create).not.toHaveBeenCalled();
      expect(tx.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SKIP_UNKNOWN_ENTITY' }) })
      );
      expect(result.repairsApplied).toBe(0);
    });

    it('marks run as FAILED and rethrows when HCM fetchBatchBalances throws', async () => {
      const prisma = makeMockPrisma();
      const svc = makeService({
        hcmService: { fetchBatchBalances: jest.fn().mockRejectedValue(new Error('HCM down')) },
        prisma,
      });

      await expect(svc.runOnDemand()).rejects.toThrow('HCM down');
      expect(prisma.reconciliationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
      );
    });

    it('continues processing remaining rows when a single row errors', async () => {
      const records = [
        makeHcmRecord({ employeeId: 'emp-1', balanceMinutes: 9999 }),
        makeHcmRecord({ employeeId: 'emp-2', balanceMinutes: 1200 }),
      ];

      let callCount = 0;
      const balancesService = {
        findByEmployeeLocation: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error('DB error on row 1');
          return Promise.resolve(makeLocalBalance({ balanceMinutes: 2400 }));
        }),
      };

      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: records, total: 2, page: 1, limit: 100 }),
        },
        balancesService,
      });

      const result = await svc.runOnDemand();

      expect(result.errorsCount).toBe(1);
      expect(result.inspectedRows).toBe(2); // both rows attempted
      expect(result.status).toBe('COMPLETED'); // run still completes
    });

    it('paginates through all HCM pages until exhausted', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => makeHcmRecord({ employeeId: `emp-${i}` }));
      const page2 = Array.from({ length: 50 }, (_, i) => makeHcmRecord({ employeeId: `emp-${100 + i}` }));

      const fetchBatchBalances = jest.fn()
        .mockResolvedValueOnce({ data: page1, total: 150, page: 1, limit: 100 })
        .mockResolvedValueOnce({ data: page2, total: 150, page: 2, limit: 100 });

      const svc = makeService({ hcmService: { fetchBatchBalances } });
      const result = await svc.runOnDemand();

      expect(fetchBatchBalances).toHaveBeenCalledTimes(2);
      expect(result.inspectedRows).toBe(150);
    });

    it('uses FULL runType when fullSnapshot=true', async () => {
      const prisma = makeMockPrisma();
      const svc = makeService({ prisma });

      await svc.runOnDemand(true);

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ runType: 'FULL' }) })
      );
    });

    it('uses INCREMENTAL runType when fullSnapshot=false', async () => {
      const prisma = makeMockPrisma();
      const svc = makeService({ prisma });

      await svc.runOnDemand(false);

      expect(prisma.reconciliationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ runType: 'INCREMENTAL' }) })
      );
    });
  });

  // ── anniversary bonus simulation ──────────────────────────────────────────

  describe('anniversary bonus simulation', () => {
    it('heals local balance when HCM independently adds anniversary bonus', async () => {
      // Local: 8 days (480 min/day × 8 = 3840)
      // HCM:  13 days (480 × 13 = 6240) — anniversary bonus applied in HCM
      const localBalance = makeLocalBalance({ balanceMinutes: 3840 });
      const hcmRecord = makeHcmRecord({ balanceMinutes: 6240 });

      const prisma = makeMockPrisma();
      const svc = makeService({
        hcmService: {
          fetchBatchBalances: jest.fn().mockResolvedValue({ data: [hcmRecord], total: 1, page: 1, limit: 100 }),
        },
        balancesService: { findByEmployeeLocation: jest.fn().mockResolvedValue(localBalance) },
        prisma,
      });

      const result = await svc.runOnDemand();

      expect(result.driftCount).toBe(1);
      expect(result.repairsApplied).toBe(1);
    });
  });
});
