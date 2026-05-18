import { Module } from '@nestjs/common';
import { PtoRequestsController } from './pto-requests.controller';
import { PtoRequestsService } from './pto-requests.service';
import { PtoRequestsRepository } from './pto-requests.repository';
import { EmployeesModule } from '../employees/employees.module';
import { LocationsModule } from '../locations/locations.module';
import { BalancesModule } from '../balances/balances.module';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [EmployeesModule, LocationsModule, BalancesModule, AuditModule, IdempotencyModule, HcmModule],
  controllers: [PtoRequestsController],
  providers: [PtoRequestsService, PtoRequestsRepository],
  exports: [PtoRequestsService],
})
export class PtoRequestsModule {}
