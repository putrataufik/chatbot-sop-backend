import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';
import { UserRole } from '../entities/user.entity';

const validate_dto = (data: any) => validate(plainToInstance(UpdateUserDto, data));

describe('UpdateUserDto', () => {
  it('should pass with an empty object (all fields optional)', async () => {
    const errors = await validate_dto({});
    expect(errors).toHaveLength(0);
  });

  it('should pass with valid full data', async () => {
    const errors = await validate_dto({
      name: 'New Name',
      role: UserRole.ADMIN,
      admin_level: 2,
      password: 'newpassword',
    });
    expect(errors).toHaveLength(0);
  });

  it('should fail when role is invalid', async () => {
    const errors = await validate_dto({ role: 'INVALID' });
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('should fail when admin_level is not an integer', async () => {
    const errors = await validate_dto({ admin_level: 'two' });
    expect(errors.some((e) => e.property === 'admin_level')).toBe(true);
  });

  it('should fail when password is too short', async () => {
    const errors = await validate_dto({ password: '123' });
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
