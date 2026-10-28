import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';

/**
 * A string of at most `max` bytes in UTF-8.
 *
 * `@MaxLength` counts UTF-16 code units, not bytes: a Sinhala or Tamil
 * letter is one unit but 3 bytes, an emoji two units but 4 bytes. Use this
 * where the limit is really in bytes, such as bcrypt's 72-byte input.
 * Non-strings pass, so pair it with `@IsString()`. The default message
 * names the field, never its value.
 */
export function MaxUtf8Bytes(
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxUtf8Bytes',
      constraints: [max],
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || Buffer.byteLength(value, 'utf8') <= max,
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must not exceed $constraint1 bytes in UTF-8`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
