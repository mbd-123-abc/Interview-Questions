import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class HcmWebhookService {
  private readonly logger = new Logger(HcmWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async processBalanceUpdate(input: {
    externalEventId: string;
    employeeId: string;
    locationId: string;
    balanceMinutes: number;
    hcmBalanceVersion: string;
    asOf: string;
  }) {
    // Idempotency check — use upsert-style: attempt create, catch unique violation
    const existing = await this.prisma.hcmBalanceSnapshot.findUnique({
      where: { externalId: input.externalEventId },
    });
    if (existing) {
      return { duplicate: true };
    }

    const balance = await this.prisma.balance.findUnique({
      where: {
        employeeId_locationId: {
          employeeId: input.employeeId,
          locationId: input.locationId,
        },
      },
    });

    if (!balance) {
      throw new NotFoundException('Local balance record not found');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Create snapshot — unique constraint on externalId guards against races
        await tx.hcmBalanceSnapshot.create({
          data: {
            employeeId: input.employeeId,
            locationId: input.locationId,
            hcmBalanceMinutes: input.balanceMinutes,
            source: 'REALTIME',
            hcmAsOf: new Date(input.asOf),
            externalId: input.externalEventId,
          },
        });

        await tx.balance.update({
          where: { id: balance.id },
          data: {
            balanceMinutes: input.balanceMinutes,
            hcmBalanceVersion: input.hcmBalanceVersion,
            lastSyncedAt: new Date(input.asOf),
            version: { increment: 1 },
          },
        });

        await tx.auditEvent.create({
          data: {
            entityType: 'BALANCE',
            entityId: balance.id,
            action: 'HCM_BALANCE_UPDATE',
            payload: JSON.stringify(input),
            source: 'HCM_WEBHOOK',
          },
        });
      });
    } catch (error) {
      // Unique constraint on externalId means a concurrent request already processed this event
      const err = error as Prisma.PrismaClientKnownRequestError;
      if (err?.code === 'P2002') {
        return { duplicate: true };
      }
      throw error;
    }

    this.logger.log(`Processed HCM balance update ${input.externalEventId}`);
    return { duplicate: false };
  }

  async processPtoRequestEvent(input: {
    externalEventId: string;
    hcmRequestId: string;
    ptoRequestId: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    notes?: string;
    actionedAt: string;
  }) {
    // Idempotency: use IdempotencyKey table scoped to HCM_PTO_EVENT
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        scope_key_actorId: {
          scope: 'HCM_PTO_EVENT',
          key: input.externalEventId,
          actorId: '',
        },
      },
    });
    if (existing) {
      return { duplicate: true };
    }

    const request = await this.prisma.pTORequest.findUnique({
      where: { id: input.ptoRequestId },
    });
    if (!request) {
      throw new NotFoundException('PTO request not found');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Record idempotency key first — unique constraint guards against races
        await tx.idempotencyKey.create({
          data: {
            scope: 'HCM_PTO_EVENT',
            key: input.externalEventId,
            actorId: '',
            status: 'COMPLETED',
          },
        });

        await tx.pTORequest.update({
          where: { id: request.id },
          data: { hcmRequestId: input.hcmRequestId },
        });

        await tx.auditEvent.create({
          data: {
            entityType: 'PTO_REQUEST',
            entityId: request.id,
            action: 'HCM_PTO_REQUEST_EVENT',
            payload: JSON.stringify(input),
            source: 'HCM_WEBHOOK',
          },
        });
      });
    } catch (error) {
      const err = error as Prisma.PrismaClientKnownRequestError;
      if (err?.code === 'P2002') {
        return { duplicate: true };
      }
      throw error;
    }

    this.logger.log(`Processed HCM PTO request event ${input.externalEventId}`);
    return { duplicate: false };
  }
}
