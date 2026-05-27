import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('should be defined', () => {
    expect(new JwtAuthGuard()).toBeDefined();
  });

  it('should be an instance of the passport jwt AuthGuard', () => {
    const guard = new JwtAuthGuard();
    expect(guard).toBeInstanceOf(AuthGuard('jwt'));
  });
});
