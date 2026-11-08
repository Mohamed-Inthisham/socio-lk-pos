import { BadRequestException } from '@nestjs/common';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import type { ProductUnit } from './entities/product-unit.entity';

/**
 * Unit codes (product_units.unit_code): SLU and at least 8 digits, such as
 * SLU00000123. The database generates them (AddProductUnitCodes). A code
 * only identifies a unit: it is never stored as an IMEI or serial number.
 */
const UNIT_CODE_PATTERN = /^SLU[0-9]{8,}$/i;

/** The answer for a code that isn't at this branch, known or not. */
export const UNIT_CODE_NOT_FOUND =
  'No item matches that unit code at this branch.';

/** The answer for an exact unit that isn't at this branch, known or not. */
export const UNIT_NOT_AT_BRANCH = 'That item is not available at this branch.';

/** The code in its stored form, or null when `value` isn't shaped like one. */
export const parseUnitCode = (value: string): string | null => {
  const trimmed = value.trim();
  return UNIT_CODE_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
};

/**
 * 400 when `value`, offered as a real IMEI or serial number, has the shape
 * of a unit code: a label scanned into the wrong field. Only that exact
 * shape: other values with letters and digits pass.
 */
export const assertNotUnitCode = (value: string): void => {
  if (parseUnitCode(value)) {
    throw new BadRequestException(
      `${value.trim()} is a unit code, not an IMEI or serial number.`,
    );
  }
};

/**
 * The real identifier a sale records for this unit: the one its product
 * tracks, or the other when it has only that. The legacy imei column is the
 * fallback for units recorded before imei_number and serial_number existed.
 */
export const unitSaleIdentifier = (
  unit: Pick<ProductUnit, 'imei' | 'imei_number' | 'serial_number'>,
  trackingMethod: TrackingMethod,
): string =>
  trackingMethod === TrackingMethod.SERIAL_NUMBER
    ? (unit.serial_number ?? unit.imei_number ?? unit.imei)
    : (unit.imei_number ?? unit.imei);
