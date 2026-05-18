/**
 * Shared test application factory.
 *
 * Boots the full NestJS app against a fresh in-memory SQLite database.
 * Each test suite calls createTestApp() in beforeAll and closes in afterAll.
 * Each test calls resetDb() in beforeEach to start from a clean slate.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { HCM_CLIENT } from '../../../modules/hcm/hcm.constants';

// ─── Controllable Mock HCM Client ────────────────────────────────────────────

export interface MockHcmControls {
  setBalance(employeeId: string, locationId: string, minutes: number, version?: string): void;
  setFailure(mode: 'none' | 'timeout' | 'error' | 'partial'): void;
  setDelay(ms: number): void;
  getBatchData(): Array<{ employeeId: string; locationId: string; balanceMinutes: number; hcmBalanceVersion: string; asOf: string }>;
  reset(): void;
}

export function createControllableMockHcm(): MockHcmControls & {
  getBalance: jest.Mock;
  createPtoRequest: jest.Mock;
  fetchBatchBalances: jest.Mock;
} {
  const balances = new Map<string, { balanceMinutes: number; hcmBalanceVersion: string }>();
  let failureMode: 'none' | 'timeout' | 'error' | 'partial' = 'none';
  let delayMs = 0;

  const maybeDelay = () => delayMs > 0 ? new Promise(r => setTimeout(r, delayMs)) : Promise.resolve();

  const maybeFailure = () => {
    if (failureMode === 'error') throw new Error('HCM service error');
    if (failureMode === 'timeout') return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('HCM timeout')), 100));
    return null;
  };

  const getBalance = jest.fn(async (employeeId: string, locationId: string) => {
    await maybeDelay();
    const fail = maybeFailure();
    if (fail) return fail;
    const key = `${employeeId}:${locationId}`;
    const stored = balances.get(key) ?? { balanceMinutes: 0, hcmBalanceVersion: 'v1' };
    return { employeeId, locationId, ...stored, asOf: new Date().toISOString() };
  });

  const createPtoRequest = jest.fn(async (input: { employeeId: string; locationId: string; requestedMinutes: number; externalIdempotencyKey: string }) => {
    await maybeDelay();
    const fail = maybeFailure();
    if (fail) return fail;
    return {
      hcmRequestId: `hcm-${Date.now()}`,
      status: 'PENDING' as const,
      balanceMinutes: 0,
      asOf: new Date().toISOString(),
    };
  });

  const fetchBatchBalances = jest.fn(async (opts: { page?: number; limit?: number }) => {
    await maybeDelay();
    const fail = maybeFailure();
    if (fail) return fail;
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 100;
    const all = Array.from(balances.entries()).map(([key, val]) => {
      const [employeeId, locationId] = key.split(':');
      return { employeeId, locationId, ...val, asOf: new Date().toISOString() };
    });
    const start = (page - 1) * limit;
    return { data: all.slice(start, start + limit), total: all.length, page, limit };
  });

  const controls: MockHcmControls = {
    setBalance(employeeId, locationId, minutes, version = 'v1') {
      balances.set(`${employeeId}:${locationId}`, { balanceMinutes: minutes, hcmBalanceVersion: version });
    },
    setFailure(mode) { failureMode = mode; },
    setDelay(ms) { delayMs = ms; },
    getBatchData() {
      return Array.from(balances.entries()).map(([key, val]) => {
        const [employeeId, locationId] = key.split(':');
        return { employeeId, locationId, ...val, asOf: new Date().toISOString() };
      });
    },
    reset() {
      balances.clear();
      failureMode = 'none';
      delayMs = 0;
      getBalance.mockClear();
      createPtoRequest.mockClear();
      fetchBatchBalances.mockClear();
    },
  };

  return { ...controls, getBalance, createPtoRequest, fetchBatchBalances };
}

// ─── App Factory ─────────────────────────────────────────────────────────────

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  hcm: ReturnType<typeof createControllableMockHcm>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const hcm = createControllableMockHcm();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(HCM_CLIENT)
    .useValue(hcm)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = moduleRef.get<PrismaService>(PrismaService);

  return {
    app,
    prisma,
    hcm,
    close: () => app.close(),
  };
}

// ─── DB Reset ────────────────────────────────────────────────────────────────

export async function resetDb(prisma: PrismaService): Promise<void> {
  // Delete in dependency order to avoid FK violations
  await prisma.balanceAdjustmentEvent.deleteMany();
  await prisma.hcmBalanceSnapshot.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.reconciliationRun.deleteMany();
  await prisma.pTORequest.deleteMany();
  await prisma.balance.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.location.deleteMany();
}

// ─── Seed Helpers ────────────────────────────────────────────────────────────

export async function seedEmployee(
  prisma: PrismaService,
  overrides: Partial<{ id: string; hcmEmployeeId: string; name: string; email: string; managerId: string }> = {},
) {
  const id = overrides.id ?? `emp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.employee.create({
    data: {
      id,
      hcmEmployeeId: overrides.hcmEmployeeId ?? `HCM-${id}`,
      name: overrides.name ?? 'Test Employee',
      email: overrides.email ?? `${id}@test.com`,
      managerId: overrides.managerId ?? null,
    },
  });
}

export async function seedLocation(
  prisma: PrismaService,
  overrides: Partial<{ id: string; code: string; name: string; timezone: string }> = {},
) {
  const id = overrides.id ?? `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.location.create({
    data: {
      id,
      code: overrides.code ?? `CODE-${id}`,
      name: overrides.name ?? 'Test Location',
      timezone: overrides.timezone ?? 'UTC',
    },
  });
}

export async function seedBalance(
  prisma: PrismaService,
  employeeId: string,
  locationId: string,
  balanceMinutes = 2400,
  pendingMinutes = 0,
) {
  return prisma.balance.create({
    data: { employeeId, locationId, balanceMinutes, pendingMinutes },
  });
}
