import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

const validate_dto = (data: any) => validate(plainToInstance(LoginDto, data));

describe('LoginDto', () => {
  it('should pass with valid email and password', async () => {
    const errors = await validate_dto({ email: 'p@e.com', password: 'secret' });
    expect(errors).toHaveLength(0);
  });

  it('should fail with an invalid email', async () => {
    const errors = await validate_dto({ email: 'bad', password: 'secret' });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('should fail when password is empty', async () => {
    const errors = await validate_dto({ email: 'p@e.com', password: '' });
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
