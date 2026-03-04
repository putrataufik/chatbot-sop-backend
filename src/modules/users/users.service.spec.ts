// FILE: src/modules/users/users.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, UserRole } from './entities/user.entity';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Mocking library bcrypt agar tidak benar-benar melakukan hashing yang lambat saat testing
jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;

  // Membuat Mock Repository dengan fungsi-fungsi dasar TypeORM
  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    // Reset semua mock sebelum setiap pengujian agar datanya tidak bocor ke test lain
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository, // Mengganti Repository asli dengan Mock
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save a new user', async () => {
      const dto = { name: 'Test User', email: 'test@example.com' };
      const savedUser = { id: 1, ...dto };

      mockUserRepository.create.mockReturnValue(savedUser);
      mockUserRepository.save.mockResolvedValue(savedUser);

      const result = await service.create(dto);

      expect(mockUserRepository.create).toHaveBeenCalledWith(dto);
      expect(mockUserRepository.save).toHaveBeenCalledWith(savedUser);
      expect(result).toEqual(savedUser);
    });
  });

  describe('findAll', () => {
    it('should return an array of users without password_hash', async () => {
      const users = [{ id: 1, name: 'Test User', email: 'test@example.com' }];
      mockUserRepository.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(mockUserRepository.find).toHaveBeenCalledWith({
        select: ['id', 'name', 'email', 'role', 'admin_level', 'last_login', 'created_at'],
      });
      expect(result).toEqual(users);
    });
  });

  describe('findById', () => {
    it('should return a user if found', async () => {
      const user = { id: 1, name: 'Test User' };
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.findById(1);

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.findById(99);

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return a user if email is found', async () => {
      const user = { id: 1, email: 'test@example.com' };
      mockUserRepository.findOne.mockResolvedValue(user);

      const result = await service.findByEmail('test@example.com');

      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(result).toEqual(user);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if user to update is not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.update(99, { name: 'New Name' })).rejects.toThrow(NotFoundException);
    });

    it('should update user without hashing password if password is not provided', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 1, name: 'Old Name' });
      const dto = { name: 'New Name', role: UserRole.ADMIN, admin_level: 2 };

      const result = await service.update(1, dto);

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        name: dto.name,
        role: dto.role,
        admin_level: dto.admin_level,
      });
      expect(result).toEqual({ message: 'User berhasil diupdate' });
    });

    it('should hash password and update user if password is provided', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 1, name: 'Old Name' });
      const dto = { name: 'New Name', password: 'newpassword123' };
      
      // Mengatur agar mock bcrypt.hash mengembalikan string tertentu
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password_123');

      const result = await service.update(1, dto);

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        name: dto.name,
        role: undefined, // karena di dto tidak dikirim
        admin_level: undefined,
        password_hash: 'hashed_password_123',
      });
      expect(result).toEqual({ message: 'User berhasil diupdate' });
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException if user to delete is not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });

    it('should delete user if found', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 1, name: 'Test User' });

      await service.remove(1);

      expect(mockUserRepository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('updateLastLogin', () => {
    it('should update last_login field with a Date', async () => {
      await service.updateLastLogin(1);

      expect(mockUserRepository.update).toHaveBeenCalledWith(1, {
        last_login: expect.any(Date),
      });
    });
  });
});