import { BadRequestException, Injectable } from '@nestjs/common';
import { BalancesRepository } from './balances.repository';
import { CreateBalanceDto } from './dto/create-balance.dto';
import { UpdateBalanceDto } from './dto/update-balance.dto';

@Injectable()
export class BalancesService {
  constructor(private readonly repository: BalancesRepository) {}

  findForEmployee(employeeId: string) {
    return this.repository.findByEmployee(employeeId);
  }

  findOne(id: string) {
    return this.repository.findById(id);
  }

  findByEmployeeLocation(employeeId: string, locationId: string) {
    return this.repository.findByEmployeeLocation(employeeId, locationId);
  }

  async create(dto: CreateBalanceDto) {
    return this.repository.create(dto);
  }

  async update(id: string, dto: UpdateBalanceDto) {
    return this.repository.update(id, dto);
  }

  async reservePending(employeeId: string, locationId: string, requestedMinutes: number) {
    const balance = await this.findByEmployeeLocation(employeeId, locationId);
    if (!balance) {
      throw new BadRequestException('Balance record not found');
    }

    const available = balance.balanceMinutes - balance.pendingMinutes;
    if (available < requestedMinutes) {
      throw new BadRequestException('Insufficient balance available for reservation');
    }

    const success = await this.repository.reservePending(employeeId, locationId, requestedMinutes, balance.version);
    if (!success) {
      throw new BadRequestException('Balance update conflict, please retry');
    }

    return this.findByEmployeeLocation(employeeId, locationId);
  }

  async confirmApproval(employeeId: string, locationId: string, requestedMinutes: number) {
    const balance = await this.findByEmployeeLocation(employeeId, locationId);
    if (!balance) {
      throw new BadRequestException('Balance record not found');
    }

    if (balance.pendingMinutes < requestedMinutes) {
      throw new BadRequestException('Pending amount is insufficient for approval');
    }

    const success = await this.repository.commitApproval(employeeId, locationId, requestedMinutes, balance.version);
    if (!success) {
      throw new BadRequestException('Balance update conflict, please retry');
    }

    return this.findByEmployeeLocation(employeeId, locationId);
  }

  async releasePending(employeeId: string, locationId: string, requestedMinutes: number) {
    const balance = await this.findByEmployeeLocation(employeeId, locationId);
    if (!balance) {
      throw new BadRequestException('Balance record not found');
    }

    if (balance.pendingMinutes < requestedMinutes) {
      throw new BadRequestException('Pending amount is insufficient to release');
    }

    const success = await this.repository.releasePending(employeeId, locationId, requestedMinutes, balance.version);
    if (!success) {
      throw new BadRequestException('Balance update conflict, please retry');
    }

    return this.findByEmployeeLocation(employeeId, locationId);
  }

  applyHcmSnapshot(employeeId: string, locationId: string, balanceMinutes: number, hcmBalanceVersion: string, hcmAsOf: Date) {
    return this.repository.applyHcmSnapshot(employeeId, locationId, balanceMinutes, hcmBalanceVersion, hcmAsOf);
  }
}
