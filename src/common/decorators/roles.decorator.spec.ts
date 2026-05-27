import { Roles, ROLES_KEY } from './roles.decorator';
import { UserRole } from '../../modules/users/entities/user.entity';

describe('Roles decorator', () => {
  it('should expose ROLES_KEY constant', () => {
    expect(ROLES_KEY).toBe('roles');
  });

  it('should attach role metadata to a target via SetMetadata', () => {
    class TestController {
      @Roles(UserRole.ADMIN)
      adminOnly() {}
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, TestController.prototype.adminOnly);
    expect(metadata).toEqual([UserRole.ADMIN]);
  });

  it('should support multiple roles', () => {
    class TestController {
      @Roles(UserRole.ADMIN, UserRole.USER)
      mixed() {}
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, TestController.prototype.mixed);
    expect(metadata).toEqual([UserRole.ADMIN, UserRole.USER]);
  });
});
