// FILE: src/modules/users/users.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(data: Partial<User>): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  async findAll(): Promise<Omit<User, 'password_hash'>[]> {
    return this.userRepository.find({
      select: [
        'id',
        'name',
        'email',
        'role',
        'admin_level',
        'last_login',
        'created_at',
      ],
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(id: number, dto: UpdateUserDto): Promise<{ message: string }> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User dengan id ${id} tidak ditemukan`);
    }

    if (dto.password) {
      const password_hash = await bcrypt.hash(dto.password, 10);
      await this.userRepository.update(id, {
        name: dto.name,
        role: dto.role,
        admin_level: dto.admin_level,
        password_hash,
      });
    } else {
      await this.userRepository.update(id, {
        name: dto.name,
        role: dto.role,
        admin_level: dto.admin_level,
      });
    }

    return { message: 'User berhasil diupdate' };
  }

  async remove(id: number): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User dengan id ${id} tidak ditemukan`);
    }
    await this.userRepository.delete(id);
  }

  async updateLastLogin(id: number): Promise<void> {
    await this.userRepository.update(id, { last_login: new Date() });
  }
}
