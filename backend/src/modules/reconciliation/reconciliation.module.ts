import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { HcmModule } from '../hcm/hcm.module';
import { BalancesModule } from '../balances/balances.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [HcmModule, BalancesModule, AuditModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
