import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PtoRequestsRepository } from './pto-requests.repository';
import { CreatePtoRequestDto } from './dto/create-pto-request.dto';
import { ApprovePtoRequestDto } from './dto/approve-pto-request.dto';
import { RejectPtoRequestDto } from './dto/reject-pto-request.dto';
import { EmployeesService } from '../employees/employees.service';
import { LocationsService } from '../locations/locations.service';
import { BalancesService } from '../balances/balances.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { HcmService } from '../hcm/hcm.service';

@Injectable()
export class PtoRequestsService {
  constructor(
    private readonly repository: PtoRequestsRepository,
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly locationsService: LocationsService,
    private readonly balancesService: BalancesService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly hcmService: HcmService,
  ) {}

  findOne(id: string) {
    return this.repository.findById(id);
  }

  findForEmployee(employeeId: string) {
    return this.repository.findByEmployee(employeeId);
  }

  async create(dto: CreatePtoRequestDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('X-Idempotency-Key header is required');
    }

    return this.idempotencyService.execute(
      'PTO_REQUEST_CREATE',
      idempotencyKey,
      dto.employeeId,
      async () => {
        const employee = await this.employeesService.findOne(dto.employeeId);
        if (!employee) throw new NotFoundException('Employee not found');

        const location = await this.locationsService.findOne(dto.locationId);
        if (!location) throw new NotFoundException('Location not found');

        if (new Date(dto.startDate) > new Date(dto.endDate)) {
          throw new BadRequestException('startDate must be before or equal to endDate');
        }

        const ptoRequest = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // Read balance inside the transaction so the version check is atomic
          const balance = await tx.balance.findUnique({
            where: {
              employeeId_locationId: {
                employeeId: dto.employeeId,
                locationId: dto.locationId,
              },
            },
          });

          if (!balance) {
            throw new BadRequestException('No balance record found for employee and location');
          }

          const available = balance.balanceMinutes - balance.pendingMinutes;
          if (available < dto.requestedMinutes) {
            throw new BadRequestException('Insufficient available balance');
          }

          // Optimistic lock: only update if version hasn't changed since we read it
          const reservation = await tx.balance.updateMany({
            where: { employeeId: dto.employeeId, locationId: dto.locationId, version: balance.version },
            data: {
              pendingMinutes: { increment: dto.requestedMinutes },
              version: { increment: 1 },
            },
          });

          if (reservation.count !== 1) {
            throw new ConflictException('Balance reservation conflict, please retry');
          }

          return tx.pTORequest.create({
            data: {
              employeeId: dto.employeeId,
              locationId: dto.locationId,
              startDate: new Date(dto.startDate),
              endDate: new Date(dto.endDate),
              requestedMinutes: dto.requestedMinutes,
              status: 'PENDING',
              memo: dto.memo,
              idempotencyKey,
            },
          });
        });

        await this.auditService.record({
          entityType: 'PTO_REQUEST',
          entityId: ptoRequest.id,
          action: 'CREATE',
          payload: dto as unknown as Record<string, unknown>,
          source: 'READYON_API',
        });

        return ptoRequest;
      },
    );
  }

  async approve(id: string, dto: ApprovePtoRequestDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('X-Idempotency-Key header is required');
    }

    return this.idempotencyService.execute(
      'PTO_REQUEST_APPROVE',
      idempotencyKey,
      dto.managerId,
      async () => {
        const ptoRequest = await this.repository.findById(id);
        if (!ptoRequest) throw new NotFoundException('PTO request not found');

        if (ptoRequest.status !== 'PENDING') {
          throw new ConflictException('Only pending PTO requests can be approved');
        }

        // FIX: read balance AND perform the update inside the same transaction
        // so the version check is atomic — no stale-read window between fetch and write
        const updatedRequest = await this.prisma.$transaction(async (tx) => {
          const balance = await tx.balance.findUnique({
            where: {
              employeeId_locationId: {
                employeeId: ptoRequest.employeeId,
                locationId: ptoRequest.locationId,
              },
            },
          });

          if (!balance) throw new NotFoundException('Balance record not found');

          if (balance.pendingMinutes < ptoRequest.requestedMinutes) {
            throw new BadRequestException('Pending balance is insufficient for approval');
          }

          const approvalResult = await tx.balance.updateMany({
            where: {
              employeeId: ptoRequest.employeeId,
              locationId: ptoRequest.locationId,
              version: balance.version,
            },
            data: {
              pendingMinutes: { decrement: ptoRequest.requestedMinutes },
              balanceMinutes: { decrement: ptoRequest.requestedMinutes },
              version: { increment: 1 },
            },
          });

          if (approvalResult.count !== 1) {
            throw new ConflictException('Balance approval conflict, please retry');
          }

          // FIX: use { increment: 1 } instead of manual version + 1 to avoid races
          return tx.pTORequest.update({
            where: { id },
            data: {
              status: 'APPROVED',
              actionedAt: new Date(),
              actionedById: dto.managerId,
              version: { increment: 1 },
            },
          });
        });

        // HCM sync is best-effort — failure is audited and reconciled later
        try {
          const hcmResponse = await this.hcmService.createPtoRequest({
            employeeId: ptoRequest.employeeId,
            locationId: ptoRequest.locationId,
            startDate: ptoRequest.startDate.toISOString(),
            endDate: ptoRequest.endDate.toISOString(),
            requestedMinutes: ptoRequest.requestedMinutes,
            externalIdempotencyKey: idempotencyKey,
          });
          await this.repository.update(id, { hcmRequestId: hcmResponse.hcmRequestId });
        } catch (error) {
          const hcmError = error as { message?: string };
          await this.auditService.record({
            entityType: 'PTO_REQUEST',
            entityId: ptoRequest.id,
            action: 'HCM_SYNC_FAILED',
            payload: { error: hcmError?.message ?? 'HCM unavailable' } as Record<string, unknown>,
            source: 'READYON_API',
          });
        }

        await this.auditService.record({
          entityType: 'PTO_REQUEST',
          entityId: updatedRequest.id,
          action: 'APPROVE',
          payload: { managerId: dto.managerId, notes: dto.notes } as Record<string, unknown>,
          source: 'READYON_API',
        });

        return updatedRequest;
      },
    );
  }

  async reject(id: string, dto: RejectPtoRequestDto, idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('X-Idempotency-Key header is required');
    }

    return this.idempotencyService.execute(
      'PTO_REQUEST_REJECT',
      idempotencyKey,
      dto.managerId,
      async () => {
        const ptoRequest = await this.repository.findById(id);
        if (!ptoRequest) throw new NotFoundException('PTO request not found');

        if (ptoRequest.status !== 'PENDING') {
          throw new ConflictException('Only pending PTO requests can be rejected');
        }

        // FIX: read balance inside the transaction — same atomic guarantee as approve
        const updatedRequest = await this.prisma.$transaction(async (tx) => {
          const balance = await tx.balance.findUnique({
            where: {
              employeeId_locationId: {
                employeeId: ptoRequest.employeeId,
                locationId: ptoRequest.locationId,
              },
            },
          });

          if (!balance) throw new NotFoundException('Balance record not found');

          if (balance.pendingMinutes < ptoRequest.requestedMinutes) {
            throw new BadRequestException('Pending balance is insufficient to reject request');
          }

          const releaseResult = await tx.balance.updateMany({
            where: {
              employeeId: ptoRequest.employeeId,
              locationId: ptoRequest.locationId,
              version: balance.version,
            },
            data: {
              pendingMinutes: { decrement: ptoRequest.requestedMinutes },
              version: { increment: 1 },
            },
          });

          if (releaseResult.count !== 1) {
            throw new ConflictException('Balance release conflict, please retry');
          }

          return tx.pTORequest.update({
            where: { id },
            data: {
              status: 'REJECTED',
              actionedAt: new Date(),
              actionedById: dto.managerId,
              version: { increment: 1 },
            },
          });
        });

        await this.auditService.record({
          entityType: 'PTO_REQUEST',
          entityId: updatedRequest.id,
          action: 'REJECT',
          payload: { managerId: dto.managerId, reason: dto.reason },
          source: 'READYON_API',
        });

        return updatedRequest;
      },
    );
  }
}
