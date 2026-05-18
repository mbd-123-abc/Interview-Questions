import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdempotencyRepository } from './idempotency.repository';

@Injectable()
export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRepository) {}

  async execute<T>(scope: string, key: string, actorId: string, callback: () => Promise<T>): Promise<T> {
    let record = await this.repository.find(scope, key, actorId);

    if (record) {
      if (record.status === 'COMPLETED') {
        // result is stored as JSON string; unwrap the { data: T } envelope
        const parsed = record.result ? JSON.parse(record.result) : null;
        return (parsed?.data ?? parsed) as T;
      }

      if (record.status === 'PENDING') {
        throw new ConflictException('Request is already being processed');
      }

      // FIX: FAILED records should be deleted so the client can retry with the
      // same key. Permanently blocking retries on transient failures is wrong —
      // the idempotency key is meant to prevent duplicate side-effects, not to
      // permanently tombstone a key after any error.
      if (record.status === 'FAILED') {
        await this.repository.delete(record.id);
        record = null as any;
      }
    }

    try {
      record = await this.repository.create({ scope, key, actorId, status: 'PENDING' });
    } catch (error) {
      const err = error as Prisma.PrismaClientKnownRequestError | Error | undefined;
      if (err && 'code' in err && err.code === 'P2002') {
        // Race: another request created the record between our find and create
        const existing = await this.repository.find(scope, key, actorId);
        if (existing?.status === 'COMPLETED') {
          const parsed = existing.result ? JSON.parse(existing.result) : null;
          return (parsed?.data ?? parsed) as T;
        }
        throw new ConflictException('Request is already being processed');
      }
      throw error;
    }

    try {
      const result = await callback();
      await this.repository.updateResult(record.id, 'COMPLETED', { data: result });
      return result;
    } catch (error) {
      await this.repository.updateResult(record.id, 'FAILED', null);
      throw error;
    }
  }
}
