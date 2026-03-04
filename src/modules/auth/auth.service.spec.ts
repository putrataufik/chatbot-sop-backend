import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../users/entities/user.entity';

// Mocking bcrypt library
jest.mock('bcrypt');

describe('AuthService', () => {
  let authService: AuthService;
  
  let mockUsersService: any;
  let mockJwtService: any;

  beforeEach(async () => {
    // Membuat objek mock untuk UsersService
    mockUsersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      updateLastLogin: jest.fn(),
    };

    // Membuat objek mock untuk JwtService
    mockJwtService = {
      sign: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    
    // Reset semua mock sebelum setiap test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  // --- TEST UNTUK REGISTER ---
  describe('register', () => {
    const registerDto = {
      name: 'Putra',
      email: 'putra@example.com',
      password: 'password123',
      role: UserRole.USER,
    };

    it('should throw ConflictException if email already exists', async () => {
      // Skenario: Email sudah ada di database
      mockUsersService.findByEmail.mockResolvedValue({ id: 1, email: 'putra@example.com' });

      await expect(authService.register(registerDto)).rejects.toThrow(ConflictException);
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
    });

    it('should register a new user successfully and return user data without password_hash', async () => {
      // Skenario: Email belum terdaftar
      mockUsersService.findByEmail.mockResolvedValue(null);
      
      // Mock hashing password
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password_123');

      // Mock kembalian dari usersService.create
      const newUser = {
        id: 1,
        name: registerDto.name,
        email: registerDto.email,
        role: registerDto.role,
        password_hash: 'hashed_password_123',
      };
      mockUsersService.create.mockResolvedValue(newUser);

      const result = await authService.register(registerDto);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 10);
      expect(mockUsersService.create).toHaveBeenCalledWith({
        name: registerDto.name,
        email: registerDto.email,
        password_hash: 'hashed_password_123',
        role: registerDto.role,
      });

      // Pastikan result tidak mengandung password_hash
      expect(result).toEqual({
        id: 1,
        name: registerDto.name,
        email: registerDto.email,
        role: registerDto.role,
      });
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  // --- TEST UNTUK LOGIN ---
  describe('login', () => {
    const loginDto = {
      email: 'putra@example.com',
      password: 'password123',
    };

    const mockUser = {
      id: 1,
      name: 'Putra',
      email: 'putra@example.com',
      role: 'user',
      password_hash: 'hashed_password_123',
    };

    it('should throw UnauthorizedException if user is not found', async () => {
      // Skenario: Email tidak ditemukan di database
      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      // Skenario: Email ditemukan, tapi password salah
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false); // Password mismatch

      await expect(authService.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.password_hash);
    });

    it('should login successfully and return access_token', async () => {
      // Skenario: Email dan password benar
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true); // Password match
      mockJwtService.sign.mockReturnValue('mocked_jwt_token'); // Mock hasil generate token

      const result = await authService.login(loginDto);

      // Verifikasi alur pemanggilan
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(bcrypt.compare).toHaveBeenCalledWith(loginDto.password, mockUser.password_hash);
      expect(mockUsersService.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
      
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });

      // Verifikasi output
      expect(result).toEqual({
        access_token: 'mocked_jwt_token',
        user: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          role: mockUser.role,
        },
      });
    });
  });
});