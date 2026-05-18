import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { ReconciliationService } from './reconciliation.service';

class RunReconciliationDto {
  @IsOptional()
  @IsBoolean()
  readonly fullSnapshot?: boolean;
}

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('status')
  getStatus() {
    return { status: 'ok' };
  }

  @Post('run')
  run(@Body() body: RunReconciliationDto) {
    return this.service.runOnDemand(body.fullSnapshot || false);
  }
}
