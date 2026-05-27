import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/users/entities/user.entity';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  const makeContext = (user: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any);

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(makeContext({ role: UserRole.USER }));

    expect(result).toBe(true);
  });

  it('should allow access when user has a required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    const result = guard.canActivate(makeContext({ role: UserRole.ADMIN }));

    expect(result).toBe(true);
  });

  it('should deny access when user lacks the required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    const result = guard.canActivate(makeContext({ role: UserRole.USER }));

    expect(result).toBe(false);
  });

  it('should allow when user role is among multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.USER]);

    const result = guard.canActivate(makeContext({ role: UserRole.USER }));

    expect(result).toBe(true);
  });
});
