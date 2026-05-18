import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { BalancesService } from './balances.service';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { UpdateBalanceDto } from './dto/update-balance.dto';

@Controller('balances')
export class BalancesController {
  constructor(private readonly service: BalancesService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get('/employee/:employeeId')
  findForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findForEmployee(employeeId);
  }

  @Post()
  create(@Body() dto: CreateBalanceDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBalanceDto) {
    return this.service.update(id, dto);
  }
}
