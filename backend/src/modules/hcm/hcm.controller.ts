import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { HcmWebhookService } from './hcm-webhook.service';
import { HcmBalanceUpdateDto } from './dto/balance-update.dto';
import { HcmPtoRequestEventDto } from './dto/pto-request-event.dto';
import { HcmWebhookGuard } from '../../common/guards/hcm-webhook.guard';

@Controller('webhooks/hcm')
@UseGuards(HcmWebhookGuard)
export class HcmController {
  constructor(private readonly webhookService: HcmWebhookService) {}

  @Post('balance-update')
  processBalanceUpdate(@Body() dto: HcmBalanceUpdateDto) {
    return this.webhookService.processBalanceUpdate(dto);
  }

  @Post('pto-request-event')
  processPtoRequestEvent(@Body() dto: HcmPtoRequestEventDto) {
    return this.webhookService.processPtoRequestEvent(dto);
  }
}
