export interface PtoRequest {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: Date;
  endDate: Date;
  requestedMinutes: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestedAt: Date;
  actionedAt?: Date | null;
  actionedById?: string | null;
  memo?: string | null;
  hcmRequestId?: string | null;
  idempotencyKey: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
