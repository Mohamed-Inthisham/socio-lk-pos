import { imeiCheckDigitMismatch, passesLuhn } from "./imei";

describe("passesLuhn", () => {
  it.each([
    ["490154203237518", true],
    ["354789102345675", true],
    ["354789102345678", false],
  ])("%s → %s", (digits, expected) => {
    expect(passesLuhn(digits)).toBe(expected);
  });
});

describe("imeiCheckDigitMismatch", () => {
  it("flags a 15-digit value whose check digit is wrong, ignoring surrounding spaces", () => {
    expect(imeiCheckDigitMismatch("354789102345678")).toBe(true);
    expect(imeiCheckDigitMismatch(" 354789102345678 ")).toBe(true);
  });

  it.each([
    ["a valid IMEI", "354789102345675"],
    ["14 digits", "35478910234567"],
    ["16 digits", "3547891023456781"],
    ["letters (serials aren't Luhn-checked)", "F2LXK0ABCDEF123"],
    ["blank", ""],
    ["undefined", undefined],
  ])("doesn't flag %s", (_, value) => {
    expect(imeiCheckDigitMismatch(value)).toBe(false);
  });
});
