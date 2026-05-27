import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategies';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    usersService = module.get(UsersService);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate()', () => {
    const payload = { sub: 1, email: 'p@e.com', role: 'USER' };

    it('should return the user when found', async () => {
      const user = { id: 1, email: 'p@e.com', role: 'USER' };
      usersService.findById.mockResolvedValue(user as any);

      const result = await strategy.validate(payload);

      expect(usersService.findById).toHaveBeenCalledWith(1);
      expect(result).toBe(user);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
  });
});
