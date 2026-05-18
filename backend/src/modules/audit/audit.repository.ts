import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(event: {
    entityType: string;
    entityId: string;
    action: string;
    payload: Record<string, unknown>;
    source: string;
    correlationId?: string;
  }) {
    return this.prisma.auditEvent.create({
      data: {
        ...event,
        payload: JSON.stringify(event.payload),
      },
    });
  }
}
