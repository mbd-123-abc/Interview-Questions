import { Module } from '@nestjs/common';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';
import { BalancesRepository } from './balances.repository';

@Module({
  controllers: [BalancesController],
  providers: [BalancesService, BalancesRepository],
  exports: [BalancesService],
})
export class BalancesModule {}
