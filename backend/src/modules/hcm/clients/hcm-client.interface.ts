export interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  balanceMinutes: number;
  hcmBalanceVersion: string;
  asOf: string;
}

export interface HcmPtoRequestResponse {
  hcmRequestId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  balanceMinutes: number;
  asOf: string;
}

export interface HcmClient {
  getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResponse>;
  createPtoRequest(input: {
    employeeId: string;
    locationId: string;
    startDate: string;
    endDate: string;
    requestedMinutes: number;
    externalIdempotencyKey: string;
  }): Promise<HcmPtoRequestResponse>;
  fetchBatchBalances(options: { since?: string; page?: number; limit?: number }): Promise<{
    data: HcmBalanceResponse[];
    total: number;
    page: number;
    limit: number;
  }>;
}
