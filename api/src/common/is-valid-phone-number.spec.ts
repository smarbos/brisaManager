import { validate } from 'class-validator';
import { IsValidPhoneNumber } from './is-valid-phone-number';

class TestDto {
  @IsValidPhoneNumber('AR')
  phone: string;
}

async function validatePhone(phone: unknown) {
  const dto = new TestDto();
  dto.phone = phone as string;
  return validate(dto);
}

describe('IsValidPhoneNumber', () => {
  it('accepts a bare Argentine local number', async () => {
    expect(await validatePhone('2235550123')).toHaveLength(0);
  });

  it('accepts a full international Argentine number', async () => {
    expect(await validatePhone('+54 9 223 555-9999')).toHaveLength(0);
  });

  it('accepts a valid foreign number with its own country code', async () => {
    expect(await validatePhone('+1 202-555-0123')).toHaveLength(0);
  });

  it('rejects a string that is not a phone number', async () => {
    const errors = await validatePhone('not a phone number');
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isValidPhoneNumber');
  });

  it('rejects a too-short number', async () => {
    expect(await validatePhone('+54911')).toHaveLength(1);
  });

  it('rejects an empty string', async () => {
    expect(await validatePhone('')).toHaveLength(1);
  });

  it('rejects a non-string value', async () => {
    expect(await validatePhone(12345678)).toHaveLength(1);
  });
});
