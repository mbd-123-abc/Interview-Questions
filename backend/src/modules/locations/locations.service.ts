import { Injectable } from '@nestjs/common';
import { LocationsRepository } from './locations.repository';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly repository: LocationsRepository) {}

  findAll() {
    return this.repository.findAll();
  }

  findOne(id: string) {
    return this.repository.findById(id);
  }

  create(dto: CreateLocationDto) {
    return this.repository.create(dto);
  }

  update(id: string, dto: UpdateLocationDto) {
    return this.repository.update(id, dto);
  }
}
