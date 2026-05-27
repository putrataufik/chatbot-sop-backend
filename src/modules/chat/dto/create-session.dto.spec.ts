import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSessionDto } from './create-session.dto';

const validate_dto = (data: any) => validate(plainToInstance(CreateSessionDto, data));

describe('CreateSessionDto', () => {
  it('should pass with no title (optional)', async () => {
    const errors = await validate_dto({});
    expect(errors).toHaveLength(0);
  });

  it('should pass with a valid title', async () => {
    const errors = await validate_dto({ title: 'Konsultasi SOP' });
    expect(errors).toHaveLength(0);
  });

  it('should fail when title is not a string', async () => {
    const errors = await validate_dto({ title: 123 });
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });
});
