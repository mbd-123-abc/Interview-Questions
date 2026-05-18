export interface AuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  source: string;
  correlationId?: string | null;
  createdAt: Date;
}
