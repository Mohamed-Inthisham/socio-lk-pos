import { applyDecorators } from '@nestjs/common';
import { NotEquals, ValidateIf, ValidationOptions } from 'class-validator';

/**
 * An optional field whose column is NOT NULL: omitting it is fine, `null`
 * is a 400 ("<field> must not be null"), and any other value runs the
 * field's own validators.
 *
 * Use it instead of `@IsOptional()`, which skips validation for `null` as
 * well as `undefined` and so lets `null` reach the database (a 500 on the
 * NOT NULL constraint) or a service that ignores it (a silent no-op).
 *
 * On a create DTO it also covers the update DTO: `PartialType(..., {
 * skipNullProperties: false })` inherits it. Fields whose column IS
 * nullable keep `@IsOptional()` so `null` still clears them.
 */
export function IsOptionalNotNull(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return applyDecorators(
    ValidateIf((_object, value) => value !== undefined),
    NotEquals(null, {
      message: '$property must not be null',
      ...validationOptions,
    }),
  );
}
