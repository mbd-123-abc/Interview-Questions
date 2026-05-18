import { Injectable } from '@nestjs/common';
import { EmployeesRepository } from './employees.repository';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly repository: EmployeesRepository) {}

  findAll() {
    return this.repository.findAll();
  }

  findOne(id: string) {
    return this.repository.findById(id);
  }

  create(dto: CreateEmployeeDto) {
    return this.repository.create(dto);
  }

  update(id: string, dto: UpdateEmployeeDto) {
    return this.repository.update(id, dto);
  }
}
