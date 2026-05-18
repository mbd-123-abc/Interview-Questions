import { Inject, Injectable } from '@nestjs/common';
import { HCM_CLIENT } from './hcm.constants';
import { HcmClient, HcmBalanceResponse, HcmPtoRequestResponse } from './clients/hcm-client.interface';

@Injectable()
export class HcmService {
  constructor(@Inject(HCM_CLIENT) private readonly client: HcmClient) {}

  getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResponse> {
    return this.client.getBalance(employeeId, locationId);
  }

  createPtoRequest(input: {
    employeeId: string;
    locationId: string;
    startDate: string;
    endDate: string;
    requestedMinutes: number;
    externalIdempotencyKey: string;
  }): Promise<HcmPtoRequestResponse> {
    return this.client.createPtoRequest(input);
  }

  fetchBatchBalances(options: { since?: string; page?: number; limit?: number }) {
    return this.client.fetchBatchBalances(options);
  }
}
