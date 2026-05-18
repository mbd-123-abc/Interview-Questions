import { Module } from '@nestjs/common';
import { MockHcmClientService } from './clients/mock-hcm-client.service';
import { HCM_CLIENT } from './hcm.constants';
import { HcmService } from './hcm.service';
import { HcmController } from './hcm.controller';
import { HcmWebhookService } from './hcm-webhook.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [HcmController],
  providers: [
    {
      provide: HCM_CLIENT,
      useClass: MockHcmClientService,
    },
    HcmService,
    HcmWebhookService,
  ],
  exports: [HCM_CLIENT, HcmService],
})
export class HcmModule {}
