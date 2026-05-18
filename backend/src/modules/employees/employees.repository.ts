import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.employee.findMany();
  }

  findById(id: string) {
    return this.prisma.employee.findUnique({ where: { id } });
  }

  create(data: { hcmEmployeeId: string; name: string; email: string; managerId?: string }) {
    return this.prisma.employee.create({ data });
  }

  update(id: string, data: { name?: string; email?: string; managerId?: string }) {
    return this.prisma.employee.update({ where: { id }, data });
  }
}
