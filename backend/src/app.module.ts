import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HcmModule } from './modules/hcm/hcm.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { LocationsModule } from './modules/locations/locations.module';
import { BalancesModule } from './modules/balances/balances.module';
import { PtoRequestsModule } from './modules/pto-requests/pto-requests.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HcmModule,
    EmployeesModule,
    LocationsModule,
    BalancesModule,
    PtoRequestsModule,
    ReconciliationModule,
    AuditModule,
  ],
})
export class AppModule {}
