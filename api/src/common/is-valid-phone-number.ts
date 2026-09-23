import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidPhoneNumber, CountryCode } from 'libphonenumber-js';

// Validates a phone number the same way both frontends do (a bare local number is assumed to
// be `defaultCountry`; a `+`-prefixed number is validated against its own country code) — see
// admin-web/guest-web's phone inputs, which use the same library client-side. This is the
// server-side boundary check: it rejects what the frontends already block, so a direct API
// call can't bypass the validation a browser would enforce.
export function IsValidPhoneNumber(
  defaultCountry: CountryCode,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidPhoneNumber',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            isValidPhoneNumber(value, defaultCountry)
          );
        },
        defaultMessage(): string {
          return `${propertyName} must be a valid phone number`;
        },
      },
    });
  };
}
