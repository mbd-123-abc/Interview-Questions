import { Injectable } from '@nestjs/common';
import { AuditRepository } from './audit.repository';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  record(event: {
    entityType: string;
    entityId: string;
    action: string;
    payload: Record<string, unknown>;
    source: string;
    correlationId?: string;
  }) {
    return this.repository.create(event);
  }
}
