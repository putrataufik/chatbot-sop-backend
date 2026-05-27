import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from '../users/entities/user.entity';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register()', () => {
    it('should delegate to authService.register and return its result', async () => {
      const dto = {
        name: 'Putra',
        email: 'putra@example.com',
        password: 'password123',
        role: UserRole.USER,
      };
      const expected = { id: 1, name: 'Putra', email: 'putra@example.com', role: UserRole.USER };
      authService.register.mockResolvedValue(expected as any);

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });

  describe('login()', () => {
    it('should delegate to authService.login and return its result', async () => {
      const dto = { email: 'putra@example.com', password: 'password123' };
      const expected = { access_token: 'jwt', user: { id: 1 } };
      authService.login.mockResolvedValue(expected as any);

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });
});
