/**
 * A product unit's IMEI and serial number, for display.
 *
 * imei_number and serial_number are the unit's identifiers. Units recorded
 * before those columns existed have only the legacy `imei` column, which
 * holds whichever identifier the product tracks, so the product's tracking
 * method says what it is. `imei` also repeats the main identifier on newer
 * units: it is only a fallback.
 *
 * @param {Object} unit - ProductUnit: imei, imei_number, serial_number
 * @param {string} [trackingMethod] - The product's: QUANTITY | IMEI | SERIAL_NUMBER
 * @returns {{ imei: string|null, serial: string|null }}
 */
export const unitIdentifiers = (unit, trackingMethod) => ({
  imei: unit.imei_number || (trackingMethod === "IMEI" && unit.imei) || null,
  serial:
    unit.serial_number ||
    (!unit.imei_number && trackingMethod === "SERIAL_NUMBER" && unit.imei) ||
    null,
});
