import { describe, expect, it } from "vitest";
import { unitIdentifiers } from "./unitIdentifiers";

const IMEI = "356789012345671";
const SERIAL = "SN-87E56576754";

describe("unitIdentifiers", () => {
  it.each([
    // tracking, imei, imei_number, serial_number, expected imei, expected serial
    ["IMEI", IMEI, IMEI, null, IMEI, null],
    ["IMEI", IMEI, IMEI, SERIAL, IMEI, SERIAL],
    ["IMEI", IMEI, null, null, IMEI, null],
    ["IMEI", IMEI, null, SERIAL, IMEI, SERIAL],
    ["SERIAL_NUMBER", SERIAL, null, SERIAL, null, SERIAL],
    ["SERIAL_NUMBER", IMEI, IMEI, SERIAL, IMEI, SERIAL],
    ["SERIAL_NUMBER", IMEI, IMEI, null, IMEI, null],
    ["SERIAL_NUMBER", SERIAL, null, null, null, SERIAL],
    ["QUANTITY", IMEI, IMEI, SERIAL, IMEI, SERIAL],
    ["QUANTITY", IMEI, null, null, null, null],
    [undefined, IMEI, null, null, null, null],
  ])(
    "%s, imei %s, imei_number %s, serial_number %s",
    (tracking, imei, imeiNumber, serialNumber, expectedImei, expectedSerial) => {
      expect(
        unitIdentifiers({ imei, imei_number: imeiNumber, serial_number: serialNumber }, tracking),
      ).toEqual({ imei: expectedImei, serial: expectedSerial });
    },
  );

  it("treats a unit from before the identifier columns as legacy (the columns are absent)", () => {
    expect(unitIdentifiers({ imei: IMEI }, "IMEI")).toEqual({ imei: IMEI, serial: null });
    expect(unitIdentifiers({ imei: SERIAL }, "SERIAL_NUMBER")).toEqual({ imei: null, serial: SERIAL });
  });
});
