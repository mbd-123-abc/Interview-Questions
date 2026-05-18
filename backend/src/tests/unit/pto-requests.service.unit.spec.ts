/**
 * UNIT TESTS — PtoRequestsService
 *
 * All dependencies mocked. Tests validation, status transitions,
 * idempotency delegation, and HCM failure isolation.
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PtoRequestsService } from '../../modules/pto-requests/pto-requests.service';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeEmployee(id = 'emp-1', managerId: string | null = 'mgr-1') {
  return { id, hcmEmployeeId: `HCM-${id}`, name: 'Alice', email: `${id}@test.com`, managerId, createdAt: new Date(), updatedAt: new Date() };
}

function makeLocation(id = 'loc-1') {
  return { id, code: 'NYC', name: 'New York', timezone: 'America/New_York', createdAt: new Date(), updatedAt: new Date() };
}

function makeBalance(overrides: Partial<{ balanceMinutes: number; pendingMinutes: number; version: number }> = {}) {
  return {
    id: 'bal-1', employeeId: 'emp-1', locationId: 'loc-1',
    balanceMinutes: 2400, pendingMinutes: 480, version: 1,
    hcmBalanceVersion: null, lastSyncedAt: null, updatedAt: new Date(),
    ...overrides,
  };
}

function makePtoRequest(overrides: Partial<{ status: string; requestedMinutes: number; version: number }> = {}) {
  return {
    id: 'req-1', employeeId: 'emp-1', locationId: 'loc-1',
    startDate: new Date('2026-06-01'), endDate: new Date('2026-06-03'),
    requestedMinutes: 480, status: 'PENDING', memo: null,
    hcmRequestId: null, idempotencyKey: 'key-1', version: 1,
    requestedAt: new Date(), actionedAt: null, actionedById: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeCreateDto(overrides: Partial<{
  employeeId: string; locationId: string; startDate: string;
  endDate: string; requestedMinutes: number; memo: string;
}> = {}) {
  return {
    employeeId: 'emp-1', locationId: 'loc-1',
    startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-03T23:59:59Z',
    requestedMinutes: 480,
    ...overrides,
  };
}

/**
 * Build a default txProxy for $transaction.
 * balance.findUnique returns a balance with pendingMinutes=480 by default
 * so approve/reject tests pass without extra setup.
 */
function makeTxProxy(balanceOverrides: Partial<{ balanceMinutes: number; pendingMinutes: number; version: number }> = {}) {
  return {
    balance: {
      findUnique: jest.fn().mockResolvedValue(makeBalance(balanceOverrides)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(makeBalance(balanceOverrides)),
    },
    pTORequest: {
      create: jest.fn().mockResolvedValue(makePtoRequest()),
      update: jest.fn().mockImplementation((args: { data: { status?: string } }) =>
        Promise.resolve(makePtoRequest({ status: args?.data?.status ?? 'PENDING' }))
      ),
    },
  };
}

/** Build a fully-mocked PtoRequestsService with all 8 dependencies. */
function makeService(overrides: {
  repository?: Partial<Record<string, jest.Mock>>;
  prisma?: Partial<Record<string, jest.Mock>>;
  employeesService?: Partial<Record<string, jest.Mock>>;
  locationsService?: Partial<Record<string, jest.Mock>>;
  balancesService?: Partial<Record<string, jest.Mock>>;
  auditService?: Partial<Record<string, jest.Mock>>;
  idempotencyService?: Partial<Record<string, jest.Mock>>;
  hcmService?: Partial<Record<string, jest.Mock>>;
} = {}) {
  const repository = {
    findById: jest.fn().mockResolvedValue(makePtoRequest()),
    findByEmployee: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(makePtoRequest()),
    update: jest.fn().mockResolvedValue(makePtoRequest()),
    ...overrides.repository,
  };

  const defaultTx = makeTxProxy();
  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: (tx: typeof defaultTx) => Promise<unknown>) => cb(defaultTx)),
    ...overrides.prisma,
  };

  const employeesService = {
    findOne: jest.fn().mockResolvedValue(makeEmployee()),
    ...overrides.employeesService,
  };

  const locationsService = {
    findOne: jest.fn().mockResolvedValue(makeLocation()),
    ...overrides.locationsService,
  };

  const balancesService = {
    findByEmployeeLocation: jest.fn().mockResolvedValue(makeBalance()),
    ...overrides.balancesService,
  };

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
    ...overrides.auditService,
  };

  const idempotencyService = {
    execute: jest.fn().mockImplementation(
      (_scope: string, _key: string, _actor: string, cb: () => Promise<unknown>) => cb()
    ),
    ...overrides.idempotencyService,
  };

  const hcmService = {
    createPtoRequest: jest.fn().mockResolvedValue({
      hcmRequestId: 'hcm-123', status: 'PENDING',
      balanceMinutes: 2400, asOf: new Date().toISOString(),
    }),
    getBalance: jest.fn(),
    fetchBatchBalances: jest.fn(),
    ...overrides.hcmService,
  };

  return new PtoRequestsService(
    repository as any,
    prisma as any,
    employeesService as any,
    locationsService as any,
    balancesService as any,
    auditService as any,
    idempotencyService as any,
    hcmService as any,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PtoRequestsService — unit', () => {

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('throws when idempotency key is missing', async () => {
      const svc = makeService();
      await expect(svc.create(makeCreateDto(), '')).rejects.toThrow('X-Idempotency-Key header is required');
    });

    it('throws NotFoundException when employee does not exist', async () => {
      const svc = makeService({ employeesService: { findOne: jest.fn().mockResolvedValue(null) } });
      await expect(svc.create(makeCreateDto(), 'key-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when location does not exist', async () => {
      const svc = makeService({ locationsService: { findOne: jest.fn().mockResolvedValue(null) } });
      await expect(svc.create(makeCreateDto(), 'key-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when startDate is after endDate', async () => {
      const dto = makeCreateDto({ startDate: '2026-06-05T00:00:00Z', endDate: '2026-06-01T00:00:00Z' });
      const svc = makeService();
      await expect(svc.create(dto, 'key-1')).rejects.toThrow('startDate must be before or equal to endDate');
    });

    it('throws when no balance record exists for employee+location', async () => {
      const tx = makeTxProxy();
      tx.balance.findUnique = jest.fn().mockResolvedValue(null);
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.create(makeCreateDto(), 'key-1')).rejects.toThrow('No balance record found');
    });

    it('throws when available balance is insufficient', async () => {
      // balance=480, pending=480 → available=0, request=480 → reject
      const tx = makeTxProxy({ balanceMinutes: 480, pendingMinutes: 480 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.create(makeCreateDto({ requestedMinutes: 480 }), 'key-1'))
        .rejects.toThrow('Insufficient available balance');
    });

    it('throws ConflictException when optimistic lock fails during reservation', async () => {
      const tx = makeTxProxy({ balanceMinutes: 2400, pendingMinutes: 0 });
      tx.balance.updateMany = jest.fn().mockResolvedValue({ count: 0 }); // lock miss
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.create(makeCreateDto(), 'key-1')).rejects.toThrow(ConflictException);
    });

    it('creates PTO request and records audit event on success', async () => {
      const auditRecord = jest.fn().mockResolvedValue(undefined);
      // create path: balance needs pendingMinutes=0 so available=2400 >= 480
      const tx = makeTxProxy({ balanceMinutes: 2400, pendingMinutes: 0 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
        auditService: { record: auditRecord },
      });

      const result = await svc.create(makeCreateDto(), 'key-1');

      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE' }));
    });

    it('delegates to idempotency service with correct scope and actor', async () => {
      const idempotencyExecute = jest.fn().mockImplementation(
        (_s: string, _k: string, _a: string, cb: () => Promise<unknown>) => cb()
      );
      const tx = makeTxProxy({ balanceMinutes: 2400, pendingMinutes: 0 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
        idempotencyService: { execute: idempotencyExecute },
      });

      await svc.create(makeCreateDto(), 'my-key');

      expect(idempotencyExecute).toHaveBeenCalledWith('PTO_REQUEST_CREATE', 'my-key', 'emp-1', expect.any(Function));
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('throws when idempotency key is missing', async () => {
      const svc = makeService();
      await expect(svc.approve('req-1', { managerId: 'mgr-1' }, '')).rejects.toThrow('X-Idempotency-Key header is required');
    });

    it('throws NotFoundException when PTO request does not exist', async () => {
      const svc = makeService({ repository: { findById: jest.fn().mockResolvedValue(null) } });
      await expect(svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when request is not PENDING', async () => {
      const svc = makeService({
        repository: { findById: jest.fn().mockResolvedValue(makePtoRequest({ status: 'APPROVED' })) },
      });
      await expect(svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1'))
        .rejects.toThrow('Only pending PTO requests can be approved');
    });

    it('throws when pending balance is insufficient for approval', async () => {
      // pendingMinutes=100 but request=480 — balance read inside tx
      const tx = makeTxProxy({ pendingMinutes: 100 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1'))
        .rejects.toThrow('Pending balance is insufficient for approval');
    });

    it('approves request and records audit event', async () => {
      const auditRecord = jest.fn().mockResolvedValue(undefined);
      // pendingMinutes=480 >= requestedMinutes=480 → approval allowed
      const tx = makeTxProxy({ pendingMinutes: 480 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
        auditService: { record: auditRecord },
      });

      const result = await svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1');

      expect(result.status).toBe('APPROVED');
      expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE' }));
    });

    it('still approves locally when HCM sync fails (graceful degradation)', async () => {
      const auditRecord = jest.fn().mockResolvedValue(undefined);
      const tx = makeTxProxy({ pendingMinutes: 480 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
        hcmService: { createPtoRequest: jest.fn().mockRejectedValue(new Error('HCM timeout')) },
        auditService: { record: auditRecord },
      });

      const result = await svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1');

      expect(result.status).toBe('APPROVED');
      expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'HCM_SYNC_FAILED' }));
    });

    it('throws ConflictException when optimistic lock fails during approval', async () => {
      const tx = makeTxProxy({ pendingMinutes: 480 });
      tx.balance.updateMany = jest.fn().mockResolvedValue({ count: 0 }); // lock miss
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.approve('req-1', { managerId: 'mgr-1' }, 'key-1'))
        .rejects.toThrow(ConflictException);
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('throws when request is not PENDING', async () => {
      const svc = makeService({
        repository: { findById: jest.fn().mockResolvedValue(makePtoRequest({ status: 'REJECTED' })) },
      });
      await expect(svc.reject('req-1', { managerId: 'mgr-1', reason: 'No coverage' }, 'key-1'))
        .rejects.toThrow('Only pending PTO requests can be rejected');
    });

    it('rejects request and releases pending balance', async () => {
      const auditRecord = jest.fn().mockResolvedValue(undefined);
      const tx = makeTxProxy({ pendingMinutes: 480 });
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
        auditService: { record: auditRecord },
      });

      const result = await svc.reject('req-1', { managerId: 'mgr-1', reason: 'No coverage' }, 'key-1');

      expect(result.status).toBe('REJECTED');
      expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'REJECT' }));
    });

    it('throws when pending balance is insufficient to reject', async () => {
      const tx = makeTxProxy({ pendingMinutes: 100 }); // 100 < 480
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.reject('req-1', { managerId: 'mgr-1', reason: 'x' }, 'key-1'))
        .rejects.toThrow('Pending balance is insufficient to reject request');
    });

    it('throws ConflictException when optimistic lock fails during release', async () => {
      const tx = makeTxProxy({ pendingMinutes: 480 });
      tx.balance.updateMany = jest.fn().mockResolvedValue({ count: 0 }); // lock miss
      const svc = makeService({
        prisma: { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) },
      });
      await expect(svc.reject('req-1', { managerId: 'mgr-1', reason: 'x' }, 'key-1'))
        .rejects.toThrow(ConflictException);
    });
  });

  // ── idempotency ───────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns cached result when idempotency service returns early', async () => {
      const cachedRequest = makePtoRequest({ status: 'PENDING' });
      const svc = makeService({
        idempotencyService: {
          execute: jest.fn().mockResolvedValue(cachedRequest),
        },
      });

      const result1 = await svc.create(makeCreateDto(), 'dup-key');
      const result2 = await svc.create(makeCreateDto(), 'dup-key');

      expect(result1).toEqual(result2);
      expect(result1.id).toBe(cachedRequest.id);
    });
  });
});
