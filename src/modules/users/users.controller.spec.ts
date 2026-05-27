import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRole } from './entities/user.entity';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: jest.fn(),
            findById: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll()', () => {
    it('should return all users from service', async () => {
      const users = [{ id: 1, name: 'A' }];
      usersService.findAll.mockResolvedValue(users as any);

      const result = await controller.findAll();

      expect(usersService.findAll).toHaveBeenCalled();
      expect(result).toBe(users);
    });
  });

  describe('getMe()', () => {
    it('should return the logged-in user without password_hash', () => {
      const req = {
        user: { id: 1, name: 'Putra', email: 'p@e.com', password_hash: 'secret', role: UserRole.USER },
      };

      const result = controller.getMe(req);

      expect(result).toEqual({ id: 1, name: 'Putra', email: 'p@e.com', role: UserRole.USER });
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  describe('findOne()', () => {
    it('should return user by id', async () => {
      const user = { id: 5, name: 'B' };
      usersService.findById.mockResolvedValue(user as any);

      const result = await controller.findOne(5);

      expect(usersService.findById).toHaveBeenCalledWith(5);
      expect(result).toBe(user);
    });
  });

  describe('update()', () => {
    it('should allow ADMIN to update any user', async () => {
      const req = { user: { id: 99, role: UserRole.ADMIN } };
      const dto = { name: 'New Name' };
      usersService.update.mockResolvedValue({ message: 'User berhasil diupdate' });

      const result = await controller.update(1, dto, req);

      expect(usersService.update).toHaveBeenCalledWith(1, dto);
      expect(result).toEqual({ message: 'User berhasil diupdate' });
    });

    it('should allow USER to update their own profile', async () => {
      const req = { user: { id: 7, role: UserRole.USER } };
      const dto = { name: 'Self Update' };
      usersService.update.mockResolvedValue({ message: 'User berhasil diupdate' });

      const result = await controller.update(7, dto, req);

      expect(usersService.update).toHaveBeenCalledWith(7, dto);
      expect(result).toEqual({ message: 'User berhasil diupdate' });
    });

    it('should throw ForbiddenException when USER updates another user', async () => {
      const req = { user: { id: 7, role: UserRole.USER } };
      const dto = { name: 'Hacker' };

      expect(() => controller.update(8, dto, req)).toThrow(ForbiddenException);
      expect(usersService.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('should remove user by id', async () => {
      usersService.remove.mockResolvedValue(undefined);

      await controller.remove(3);

      expect(usersService.remove).toHaveBeenCalledWith(3);
    });
  });
});
