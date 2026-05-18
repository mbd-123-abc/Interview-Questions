import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PtoRequestsService } from './pto-requests.service';
import { CreatePtoRequestDto } from './dto/create-pto-request.dto';
import { ApprovePtoRequestDto } from './dto/approve-pto-request.dto';
import { RejectPtoRequestDto } from './dto/reject-pto-request.dto';

@Controller('pto-requests')
export class PtoRequestsController {
  constructor(private readonly service: PtoRequestsService) {}

  @Get('employee/:employeeId')
  findForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findForEmployee(employeeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Headers('x-idempotency-key') idempotencyKey: string, @Body() dto: CreatePtoRequestDto) {
    return this.service.create(dto, idempotencyKey);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body() dto: ApprovePtoRequestDto,
  ) {
    return this.service.approve(id, dto, idempotencyKey);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body() dto: RejectPtoRequestDto,
  ) {
    return this.service.reject(id, dto, idempotencyKey);
  }
}
