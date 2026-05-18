import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(scope: string, key: string, actorId?: string) {
    return this.prisma.idempotencyKey.findUnique({
      where: {
        scope_key_actorId: {
          scope,
          key,
          actorId: actorId ?? '',
        },
      },
    });
  }

  create(data: { scope: string; key: string; actorId?: string; status?: string }) {
    return this.prisma.idempotencyKey.create({
      data: {
        scope: data.scope,
        key: data.key,
        actorId: data.actorId ?? '',
        status: data.status ?? 'PENDING',
      },
    });
  }

  updateResult(id: string, status: 'COMPLETED' | 'FAILED', result: Record<string, unknown> | null) {
    return this.prisma.idempotencyKey.update({
      where: { id },
      data: {
        status,
        result: result !== null ? JSON.stringify(result) : null,
      },
    });
  }

  findById(id: string) {
    return this.prisma.idempotencyKey.findUnique({ where: { id } });
  }

  delete(id: string) {
    return this.prisma.idempotencyKey.delete({ where: { id } });
  }
}
