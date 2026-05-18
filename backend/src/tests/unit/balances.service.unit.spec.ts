/**
 * UNIT TESTS — BalancesService
 *
 * All dependencies are mocked. No DB, no HTTP.
 * Tests pure business logic: validation, state transitions, optimistic locking.
 */

import { BadRequestException } from '@nestjs/common';
import { BalancesService } from '../../modules/balances/balances.service';
import { BalancesRepository } from '../../modules/balances/balances.repository';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBalance(overrides: Partial<{
  id: string;
  employeeId: string;
  locationId: string;
  balanceMinutes: number;
  pendingMinutes: number;
  version: number;
  hcmBalanceVersion: string | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'bal-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    balanceMinutes: 2400,
    pendingMinutes: 0,
    version: 1,
    hcmBalanceVersion: null,
    lastSyncedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<BalancesRepository> = {}): jest.Mocked<BalancesRepository> {
  return {
    findByEmployee: jest.fn(),
    findById: jest.fn(),
    findByEmployeeLocation: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    reservePending: jest.fn(),
    commitApproval: jest.fn(),
    releasePending: jest.fn(),
    applyHcmSnapshot: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<BalancesRepository>;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('BalancesService — unit', () => {

  // ── reservePending ────────────────────────────────────────────────────────

  describe('reservePending', () => {
    it('allows reservation when available balance is sufficient', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 0, version: 1 });
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValueOnce(balance).mockResolvedValueOnce({ ...balance, pendingMinutes: 120, version: 2 }),
        reservePending: jest.fn().mockResolvedValue(true),
      });
      const svc = new BalancesService(repo);

      const result = await svc.reservePending('emp-1', 'loc-1', 120);

      expect(repo.reservePending).toHaveBeenCalledWith('emp-1', 'loc-1', 120, 1);
      expect(result?.pendingMinutes).toBe(120);
    });

    it('rejects when requestedMinutes exceeds available balance', async () => {
      // balance=600, pending=500 → available=100, request=200 → reject
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 500 });
      const repo = makeMockRepo({ findByEmployeeLocation: jest.fn().mockResolvedValue(balance) });
      const svc = new BalancesService(repo);

      await expect(svc.reservePending('emp-1', 'loc-1', 200))
        .rejects.toThrow(BadRequestException);
      expect(repo.reservePending).not.toHaveBeenCalled();
    });

    it('rejects when balance is exactly zero available', async () => {
      const balance = makeBalance({ balanceMinutes: 480, pendingMinutes: 480 });
      const repo = makeMockRepo({ findByEmployeeLocation: jest.fn().mockResolvedValue(balance) });
      const svc = new BalancesService(repo);

      await expect(svc.reservePending('emp-1', 'loc-1', 1))
        .rejects.toThrow('Insufficient balance available for reservation');
    });

    it('allows reservation when requestedMinutes equals exactly available balance', async () => {
      const balance = makeBalance({ balanceMinutes: 480, pendingMinutes: 0, version: 1 });
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValueOnce(balance).mockResolvedValueOnce({ ...balance, pendingMinutes: 480, version: 2 }),
        reservePending: jest.fn().mockResolvedValue(true),
      });
      const svc = new BalancesService(repo);

      await expect(svc.reservePending('emp-1', 'loc-1', 480)).resolves.toBeDefined();
    });

    it('throws when balance record does not exist', async () => {
      const repo = makeMockRepo({ findByEmployeeLocation: jest.fn().mockResolvedValue(null) });
      const svc = new BalancesService(repo);

      await expect(svc.reservePending('emp-1', 'loc-1', 100))
        .rejects.toThrow('Balance record not found');
    });

    it('throws conflict when optimistic lock fails (version mismatch)', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 0, version: 1 });
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValue(balance),
        reservePending: jest.fn().mockResolvedValue(false), // version mismatch → 0 rows updated
      });
      const svc = new BalancesService(repo);

      await expect(svc.reservePending('emp-1', 'loc-1', 100))
        .rejects.toThrow('Balance update conflict, please retry');
    });
  });

  // ── confirmApproval ───────────────────────────────────────────────────────

  describe('confirmApproval', () => {
    it('commits approval when pending is sufficient', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 480, version: 3 });
      const afterCommit = { ...balance, balanceMinutes: 120, pendingMinutes: 0, version: 4 };
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValueOnce(balance).mockResolvedValueOnce(afterCommit),
        commitApproval: jest.fn().mockResolvedValue(true),
      });
      const svc = new BalancesService(repo);

      const result = await svc.confirmApproval('emp-1', 'loc-1', 480);

      expect(repo.commitApproval).toHaveBeenCalledWith('emp-1', 'loc-1', 480, 3);
      expect(result?.balanceMinutes).toBe(120);
      expect(result?.pendingMinutes).toBe(0);
    });

    it('rejects when pendingMinutes is less than requestedMinutes', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 100 });
      const repo = makeMockRepo({ findByEmployeeLocation: jest.fn().mockResolvedValue(balance) });
      const svc = new BalancesService(repo);

      await expect(svc.confirmApproval('emp-1', 'loc-1', 200))
        .rejects.toThrow('Pending amount is insufficient for approval');
    });

    it('throws conflict on optimistic lock failure during approval', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 480, version: 2 });
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValue(balance),
        commitApproval: jest.fn().mockResolvedValue(false),
      });
      const svc = new BalancesService(repo);

      await expect(svc.confirmApproval('emp-1', 'loc-1', 480))
        .rejects.toThrow('Balance update conflict, please retry');
    });
  });

  // ── releasePending ────────────────────────────────────────────────────────

  describe('releasePending', () => {
    it('releases pending when amount is sufficient', async () => {
      const balance = makeBalance({ balanceMinutes: 600, pendingMinutes: 480, version: 2 });
      const afterRelease = { ...balance, pendingMinutes: 0, version: 3 };
      const repo = makeMockRepo({
        findByEmployeeLocation: jest.fn().mockResolvedValueOnce(balance).mockResolvedValueOnce(afterRelease),
        releasePending: jest.fn().mockResolvedValue(true),
      });
      const svc = new BalancesService(repo);

      const result = await svc.releasePending('emp-1', 'loc-1', 480);

      expect(repo.releasePending).toHaveBeenCalledWith('emp-1', 'loc-1', 480, 2);
      expect(result?.pendingMinutes).toBe(0);
      // balanceMinutes unchanged on rejection
      expect(result?.balanceMinutes).toBe(600);
    });

    it('rejects when pendingMinutes is less than amount to release', async () => {
      const balance = makeBalance({ pendingMinutes: 100 });
      const repo = makeMockRepo({ findByEmployeeLocation: jest.fn().mockResolvedValue(balance) });
      const svc = new BalancesService(repo);

      await expect(svc.releasePending('emp-1', 'loc-1', 200))
        .rejects.toThrow('Pending amount is insufficient to release');
    });
  });

  // ── balance invariant property ────────────────────────────────────────────

  describe('balance invariant: availableMinutes never negative', () => {
    const cases = [
      { balance: 0,    pending: 0,    request: 1,   shouldAllow: false },
      { balance: 100,  pending: 100,  request: 1,   shouldAllow: false },
      { balance: 100,  pending: 50,   request: 50,  shouldAllow: true  },
      { balance: 100,  pending: 50,   request: 51,  shouldAllow: false },
      { balance: 2400, pending: 0,    request: 2400,shouldAllow: true  },
      { balance: 2400, pending: 2399, request: 2,   shouldAllow: false },
    ];

    cases.forEach(({ balance, pending, request, shouldAllow }) => {
      it(`balance=${balance} pending=${pending} request=${request} → ${shouldAllow ? 'allowed' : 'rejected'}`, async () => {
        const bal = makeBalance({ balanceMinutes: balance, pendingMinutes: pending });
        const repo = makeMockRepo({
          findByEmployeeLocation: jest.fn().mockResolvedValue(bal),
          reservePending: jest.fn().mockResolvedValue(true),
        });
        const svc = new BalancesService(repo);

        if (shouldAllow) {
          await expect(svc.reservePending('emp-1', 'loc-1', request)).resolves.toBeDefined();
        } else {
          await expect(svc.reservePending('emp-1', 'loc-1', request)).rejects.toThrow(BadRequestException);
        }
      });
    });
  });

  // ── applyHcmSnapshot ──────────────────────────────────────────────────────

  describe('applyHcmSnapshot', () => {
    it('delegates to repository with correct arguments', async () => {
      const repo = makeMockRepo({ applyHcmSnapshot: jest.fn().mockResolvedValue(makeBalance()) });
      const svc = new BalancesService(repo);
      const asOf = new Date('2026-01-01T00:00:00Z');

      await svc.applyHcmSnapshot('emp-1', 'loc-1', 9999, 'v42', asOf);

      expect(repo.applyHcmSnapshot).toHaveBeenCalledWith('emp-1', 'loc-1', 9999, 'v42', asOf);
    });
  });
});
