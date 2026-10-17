import { QueryFailedError } from 'typeorm';
import { ProductUnitStatus } from './enums/product-unit-status.enum';

/**
 * Statuses that mean "the shop holds this phone". An IMEI may have at
 * most one ProductUnit in these statuses (uq_product_units_imei_live);
 * SOLD and RETURNED rows are history and may repeat an IMEI, so a phone
 * can be acquired again (buy-back, or a re-ring after a voided trade-in).
 *
 * Keep in step with the WHERE clause of uq_product_units_imei_live (see
 * the ProductUnitsImeiUniqueWhenLive migration and the entity @Index).
 */
export const LIVE_UNIT_STATUSES: readonly ProductUnitStatus[] = [
  ProductUnitStatus.IN_STOCK,
  ProductUnitStatus.WRITTEN_OFF,
];

export const LIVE_IMEI_INDEX = 'uq_product_units_imei_live';

/**
 * True only for a unique violation on uq_product_units_imei_live: two
 * transactions made the same IMEI live at once, past the service's
 * pre-check. Callers map it to a 409 and let every other error propagate.
 */
export const isLiveImeiConflict = (err: unknown): boolean =>
  err instanceof QueryFailedError &&
  (err.driverError as { constraint?: string }).constraint === LIVE_IMEI_INDEX;
