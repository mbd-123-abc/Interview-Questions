import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ReconciliationWorker {
  private readonly logger = new Logger(ReconciliationWorker.name);

  async execute() {
    this.logger.log('Reconciling balances with HCM');
    // placeholder for reconciliation task execution logic
  }
}
