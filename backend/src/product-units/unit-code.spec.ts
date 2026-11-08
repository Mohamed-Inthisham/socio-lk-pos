import { BadRequestException } from '@nestjs/common';
import { TrackingMethod } from '../products/enums/tracking-method.enum';
import {
  assertNotUnitCode,
  parseUnitCode,
  unitSaleIdentifier,
} from './unit-code';

describe('unit codes', () => {
  describe('parseUnitCode', () => {
    it.each([
      ['SLU00000123', 'SLU00000123'],
      ['slu00000123', 'SLU00000123'],
      ['Slu00000123', 'SLU00000123'],
      ['  SLU00000123  ', 'SLU00000123'],
      ['SLU100000000', 'SLU100000000'],
      ['SLU1234567890123', 'SLU1234567890123'],
    ])('reads %s as %s', (value, code) => {
      expect(parseUnitCode(value)).toBe(code);
    });

    it.each([
      ['fewer than 8 digits', 'SLU1234567'],
      ['a hyphen', 'SLU-00000123'],
      ['a letter among the digits', 'SLU0000012A'],
      ['text before it', 'XSLU00000123'],
      ['text after it', 'SLU00000123X'],
      ['a product barcode', 'SLP-000042'],
      ['an IMEI', '356938035643809'],
      ['an empty value', ''],
    ])('does not read %s as a code', (_, value) => {
      expect(parseUnitCode(value)).toBeNull();
    });
  });

  describe('assertNotUnitCode', () => {
    it.each(['SLU00000123', 'slu00000123', ' SLU100000000 '])(
      'refuses %s',
      (value) => {
        expect(() => assertNotUnitCode(value)).toThrow(BadRequestException);
      },
    );

    it.each([
      '356938035643809',
      'SN-87E56576754',
      'SLU1234567',
      'ABSLU12345678',
    ])('accepts the real identifier %s', (value) => {
      expect(() => assertNotUnitCode(value)).not.toThrow();
    });
  });

  describe('unitSaleIdentifier', () => {
    const IMEI = '356938035643809';
    const SERIAL = 'SN-1';

    it('gives an IMEI product its IMEI, even with a serial number too', () => {
      expect(
        unitSaleIdentifier(
          { imei: IMEI, imei_number: IMEI, serial_number: SERIAL },
          TrackingMethod.IMEI,
        ),
      ).toBe(IMEI);
    });

    it('gives a serial product its serial number, even with an IMEI too', () => {
      expect(
        unitSaleIdentifier(
          { imei: IMEI, imei_number: IMEI, serial_number: SERIAL },
          TrackingMethod.SERIAL_NUMBER,
        ),
      ).toBe(SERIAL);
    });

    it('gives a serial product its IMEI when it has no serial number', () => {
      expect(
        unitSaleIdentifier(
          { imei: IMEI, imei_number: IMEI, serial_number: null },
          TrackingMethod.SERIAL_NUMBER,
        ),
      ).toBe(IMEI);
    });

    it.each([TrackingMethod.IMEI, TrackingMethod.SERIAL_NUMBER])(
      'falls back to the legacy imei column for an older %s unit',
      (method) => {
        expect(
          unitSaleIdentifier(
            { imei: 'LEGACY-1', imei_number: null, serial_number: null },
            method,
          ),
        ).toBe('LEGACY-1');
      },
    );
  });
});
