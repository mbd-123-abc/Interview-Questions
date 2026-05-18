import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.location.findMany();
  }

  findById(id: string) {
    return this.prisma.location.findUnique({ where: { id } });
  }

  create(data: { code: string; name: string; timezone: string }) {
    return this.prisma.location.create({ data });
  }

  update(id: string, data: { name?: string; timezone?: string }) {
    return this.prisma.location.update({ where: { id }, data });
  }
}
