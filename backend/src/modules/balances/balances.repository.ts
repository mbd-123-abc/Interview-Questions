import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BalancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployee(employeeId: string) {
    return this.prisma.balance.findMany({ where: { employeeId } });
  }

  findById(id: string) {
    return this.prisma.balance.findUnique({ where: { id } });
  }

  findByEmployeeLocation(employeeId: string, locationId: string) {
    return this.prisma.balance.findUnique({
      where: { employeeId_locationId: { employeeId, locationId } },
    });
  }

  create(data: { employeeId: string; locationId: string; balanceMinutes: number }) {
    return this.prisma.balance.create({ data });
  }

  update(
    id: string,
    data: Partial<{
      balanceMinutes: number;
      pendingMinutes: number;
      version: number;
      hcmBalanceVersion: string | null;
      lastSyncedAt: Date | null;
    }>,
  ) {
    return this.prisma.balance.update({ where: { id }, data });
  }

  async reservePending(
    employeeId: string,
    locationId: string,
    requestedMinutes: number,
    version: number,
  ): Promise<boolean> {
    const result = await this.prisma.balance.updateMany({
      where: { employeeId, locationId, version },
      data: {
        pendingMinutes: { increment: requestedMinutes },
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async commitApproval(
    employeeId: string,
    locationId: string,
    requestedMinutes: number,
    version: number,
  ): Promise<boolean> {
    const result = await this.prisma.balance.updateMany({
      where: { employeeId, locationId, version },
      data: {
        pendingMinutes: { decrement: requestedMinutes },
        balanceMinutes: { decrement: requestedMinutes },
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async releasePending(
    employeeId: string,
    locationId: string,
    requestedMinutes: number,
    version: number,
  ): Promise<boolean> {
    const result = await this.prisma.balance.updateMany({
      where: { employeeId, locationId, version },
      data: {
        pendingMinutes: { decrement: requestedMinutes },
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async applyHcmSnapshot(
    employeeId: string,
    locationId: string,
    balanceMinutes: number,
    hcmBalanceVersion: string,
    hcmAsOf: Date,
  ) {
    const balance = await this.findByEmployeeLocation(employeeId, locationId);

    if (!balance) {
      return this.prisma.balance.create({
        data: {
          employeeId,
          locationId,
          balanceMinutes,
          pendingMinutes: 0,
          hcmBalanceVersion,
          lastSyncedAt: hcmAsOf,
        },
      });
    }

    return this.prisma.balance.update({
      where: { id: balance.id },
      data: {
        balanceMinutes,
        hcmBalanceVersion,
        lastSyncedAt: hcmAsOf,
        version: { increment: 1 },
      },
    });
  }
}
