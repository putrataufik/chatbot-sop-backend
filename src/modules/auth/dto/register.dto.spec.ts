import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { UserRole } from '../../users/entities/user.entity';

const validate_dto = (data: any) => validate(plainToInstance(RegisterDto, data));

describe('RegisterDto', () => {
  const validData = {
    name: 'Putra',
    email: 'putra@example.com',
    password: 'password123',
    role: UserRole.USER,
  };

  it('should pass with valid data', async () => {
    const errors = await validate_dto(validData);
    expect(errors).toHaveLength(0);
  });

  it('should fail when name is empty', async () => {
    const errors = await validate_dto({ ...validData, name: '' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('should fail with an invalid email', async () => {
    const errors = await validate_dto({ ...validData, email: 'not-an-email' });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('should fail when password is shorter than 6 characters', async () => {
    const errors = await validate_dto({ ...validData, password: '123' });
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('should fail with an invalid role', async () => {
    const errors = await validate_dto({ ...validData, role: 'SUPERUSER' });
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
