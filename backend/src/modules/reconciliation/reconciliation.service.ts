import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { HcmService } from '../hcm/hcm.service';
import { AuditService } from '../audit/audit.service';
import { BalancesService } from '../balances/balances.service';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly hcmService: HcmService,
    private readonly auditService: AuditService,
    private readonly balancesService: BalancesService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runHourlyReconciliation() {
    this.logger.log('Starting hourly reconciliation');
    return this.reconcile('INCREMENTAL');
  }

  async runOnDemand(fullSnapshot = false) {
    this.logger.log(`Running on-demand reconciliation fullSnapshot=${fullSnapshot}`);
    return this.reconcile(fullSnapshot ? 'FULL' : 'INCREMENTAL');
  }

  private async reconcile(runType: 'FULL' | 'INCREMENTAL') {
    const run = await this.prisma.reconciliationRun.create({
      data: { runType, status: 'RUNNING' },
    });

    let inspectedRows = 0;
    let driftCount = 0;
    let repairsApplied = 0;
    let errorsCount = 0;
    let lastError: string | undefined;

    try {
      let page = 1;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        const result = await this.hcmService.fetchBatchBalances({ page, limit });

        for (const record of result.data) {
          try {
            inspectedRows += 1;
            const balance = await this.balancesService.findByEmployeeLocation(
              record.employeeId,
              record.locationId,
            );

            // Track whether this row needs a repair — set inside tx, read after
            let rowRepaired = false;
            let rowDrift = false;

            await this.prisma.$transaction(async (tx) => {
              await tx.hcmBalanceSnapshot.create({
                data: {
                  employeeId: record.employeeId,
                  locationId: record.locationId,
                  hcmBalanceMinutes: record.balanceMinutes,
                  source: 'BATCH',
                  hcmAsOf: new Date(record.asOf),
                  externalId: null,
                },
              });

              if (!balance) {
                const employee = await tx.employee.findUnique({ where: { id: record.employeeId } });
                const location = await tx.location.findUnique({ where: { id: record.locationId } });

                if (!employee || !location) {
                  await tx.auditEvent.create({
                    data: {
                      entityType: 'RECONCILIATION',
                      entityId: `${record.employeeId}-${record.locationId}`,
                      action: 'SKIP_UNKNOWN_ENTITY',
                      payload: JSON.stringify(record),
                      source: 'RECONCILIATION',
                    },
                  });
                  return;
                }

                await tx.balance.create({
                  data: {
                    employeeId: record.employeeId,
                    locationId: record.locationId,
                    balanceMinutes: record.balanceMinutes,
                    pendingMinutes: 0,
                    hcmBalanceVersion: record.hcmBalanceVersion,
                    lastSyncedAt: new Date(record.asOf),
                  },
                });
                // FIX: mark intent outside tx body so counter increments once after commit
                rowRepaired = true;
                return;
              }

              if (balance.balanceMinutes !== record.balanceMinutes) {
                await tx.balance.update({
                  where: { id: balance.id },
                  data: {
                    balanceMinutes: record.balanceMinutes,
                    hcmBalanceVersion: record.hcmBalanceVersion,
                    lastSyncedAt: new Date(record.asOf),
                    version: { increment: 1 },
                  },
                });

                await tx.auditEvent.create({
                  data: {
                    entityType: 'BALANCE',
                    entityId: balance.id,
                    action: 'RECONCILIATION_ADJUSTMENT',
                    payload: JSON.stringify({
                      localBalanceMinutes: balance.balanceMinutes,
                      hcmBalanceMinutes: record.balanceMinutes,
                      pendingMinutes: balance.pendingMinutes,
                    }),
                    source: 'RECONCILIATION',
                  },
                });
                rowDrift = true;
                rowRepaired = true;
              } else {
                await tx.balance.update({
                  where: { id: balance.id },
                  data: {
                    hcmBalanceVersion: record.hcmBalanceVersion,
                    lastSyncedAt: new Date(record.asOf),
                  },
                });
              }
            });

            // FIX: increment counters only after the transaction commits successfully
            if (rowDrift) driftCount += 1;
            if (rowRepaired) repairsApplied += 1;
          } catch (rowError) {
            errorsCount += 1;
            lastError = (rowError as Error).message;
            this.logger.warn(`Reconciliation row error: ${lastError}`);
          }
        }

        hasMore = result.data.length === limit;
        page += 1;
      }

      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          inspectedRows,
          driftCount,
          repairsApplied,
          errorsCount,
          lastError: lastError ?? null,
        },
      });

      return { runId: run.id, status: 'COMPLETED', inspectedRows, driftCount, repairsApplied, errorsCount };
    } catch (error) {
      const err = error as Error;
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorsCount: errorsCount + 1,
          lastError: err.message ?? 'Unknown reconciliation error',
        },
      });
      this.logger.error('Reconciliation failed', err.stack);
      throw error;
    }
  }
}
