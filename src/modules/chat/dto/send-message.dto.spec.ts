import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageDto } from './send-message.dto';

const validate_dto = (data: any) => validate(plainToInstance(SendMessageDto, data));

describe('SendMessageDto', () => {
  it('should pass with valid content', async () => {
    const errors = await validate_dto({ content: 'Bagaimana prosedur cuti?' });
    expect(errors).toHaveLength(0);
  });

  it('should fail when content is empty', async () => {
    const errors = await validate_dto({ content: '' });
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('should fail when content is missing', async () => {
    const errors = await validate_dto({});
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });
});
