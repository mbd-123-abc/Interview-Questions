import { Injectable } from '@nestjs/common';
import { HcmClient, HcmBalanceResponse, HcmPtoRequestResponse } from './hcm-client.interface';

@Injectable()
export class MockHcmClientService implements HcmClient {
  async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResponse> {
    return {
      employeeId,
      locationId,
      balanceMinutes: 0,
      hcmBalanceVersion: 'initial',
      asOf: new Date().toISOString(),
    };
  }

  async createPtoRequest(input: {
    employeeId: string;
    locationId: string;
    startDate: string;
    endDate: string;
    requestedMinutes: number;
    externalIdempotencyKey: string;
  }): Promise<HcmPtoRequestResponse> {
    return {
      hcmRequestId: 'mock-hcm-request-id',
      status: 'PENDING',
      balanceMinutes: 0,
      asOf: new Date().toISOString(),
    };
  }

  async fetchBatchBalances(options: { since?: string; page?: number; limit?: number }) {
    return {
      data: [],
      total: 0,
      page: options.page || 1,
      limit: options.limit || 100,
    };
  }
}
