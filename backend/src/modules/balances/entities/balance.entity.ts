export interface Balance {
  id: string;
  employeeId: string;
  locationId: string;
  balanceMinutes: number;
  pendingMinutes: number;
  version: number;
  hcmBalanceVersion?: string | null;
  lastSyncedAt?: Date | null;
  updatedAt: Date;
}
