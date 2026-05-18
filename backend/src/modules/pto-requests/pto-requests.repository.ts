import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PtoRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.pTORequest.findUnique({ where: { id } });
  }

  findByEmployee(employeeId: string) {
    return this.prisma.pTORequest.findMany({
      where: { employeeId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  create(data: {
    employeeId: string;
    locationId: string;
    startDate: Date;
    endDate: Date;
    requestedMinutes: number;
    status: string;
    memo?: string;
    idempotencyKey: string;
  }) {
    return this.prisma.pTORequest.create({ data });
  }

  update(
    id: string,
    data: Partial<{
      status: string;
      actionedAt: Date;
      actionedById: string;
      hcmRequestId: string;
      memo: string;
      version: number | { increment: number };
    }>,
  ) {
    return this.prisma.pTORequest.update({ where: { id }, data });
  }
}
