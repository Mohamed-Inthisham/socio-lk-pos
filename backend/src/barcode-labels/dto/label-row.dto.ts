import { ApiProperty } from '@nestjs/swagger';
import { BarcodeType } from '../../products/enums/barcode-type.enum';
import { TrackingMethod } from '../../products/enums/tracking-method.enum';

/**
 * Label rows for the Barcode Labels page (Stage 2): exactly what a printed
 * label needs, and nothing else.
 *
 * Every row is a plain object built field by field from columns selected by
 * name, as GET /product-units/search does: never an entity. So no buying or
 * cost price, no customer, no sale or sale line can reach a label, whoever
 * asks. The serializer's cost rule (@ExposeCost) only covers entities, so it
 * must not be relied on here: these classes simply have no such field.
 *
 * Prices are decimal strings, as the entities return them, and null when
 * none is set: the label then prints without a price.
 */

/** Which kind of label a row is: the discriminator of LabelRow. */
export enum LabelKind {
  PRODUCT = 'PRODUCT',
  UNIT = 'UNIT',
}

/** The real identifier a unit label shows in readable text. */
export type UnitIdentifierType =
  | TrackingMethod.IMEI
  | TrackingMethod.SERIAL_NUMBER;

/** The tracking methods whose products get unit labels. */
export type UnitTrackingMethod =
  | TrackingMethod.IMEI
  | TrackingMethod.SERIAL_NUMBER;

const UNIT_TRACKING_METHODS = [
  TrackingMethod.IMEI,
  TrackingMethod.SERIAL_NUMBER,
];

/**
 * A product-level label, for a QUANTITY-tracked product. The response keeps
 * the stored barcode. Generated labels encode the full numeric barcode,
 * which the POS resolves directly to the product.
 */
export class ProductLabelRowDto {
  @ApiProperty({ enum: [LabelKind.PRODUCT], example: LabelKind.PRODUCT })
  kind!: LabelKind.PRODUCT;

  @ApiProperty({
    format: 'uuid',
    example: '33333333-3333-3333-3333-333333333333',
  })
  product_id!: string;

  @ApiProperty({ example: 'USB-C Charger 20W' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'PD-20' })
  model!: string | null;

  @ApiProperty({ example: 'SKU-000123' })
  sku!: string;

  @ApiProperty({
    example: '12345678',
    description: 'Stored product barcode; generated product barcodes are eight digits',
  })
  barcode!: string;

  @ApiProperty({ enum: BarcodeType, example: BarcodeType.CODE_128 })
  barcode_type!: BarcodeType;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '4500.00',
    description: 'The product selling price; null when none is set',
  })
  selling_price!: string | null;
}

/** The branch a unit is at, by id and name only. */
export class LabelBranchDto {
  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  id!: string;

  @ApiProperty({ example: 'Colombo' })
  name!: string;
}

/**
 * An individual unit label, for an IMEI- or serial-tracked product. The
 * barcode encodes unit_code, never the IMEI or serial number; the real
 * identifier is printed as readable text only.
 */
export class UnitLabelRowDto {
  @ApiProperty({ enum: [LabelKind.UNIT], example: LabelKind.UNIT })
  kind!: LabelKind.UNIT;

  @ApiProperty({
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  unit_id!: string;

  @ApiProperty({
    example: '87654321',
    description: 'The value the label barcode encodes',
  })
  unit_code!: string;

  @ApiProperty({
    format: 'uuid',
    example: '33333333-3333-3333-3333-333333333333',
  })
  product_id!: string;

  @ApiProperty({ example: 'iPhone 13 128GB' })
  name!: string;

  @ApiProperty({ enum: UNIT_TRACKING_METHODS, example: TrackingMethod.IMEI })
  tracking_method!: UnitTrackingMethod;

  @ApiProperty({
    enum: UNIT_TRACKING_METHODS,
    example: TrackingMethod.IMEI,
    description: 'Which real identifier `identifier` is',
  })
  identifier_type!: UnitIdentifierType;

  @ApiProperty({
    example: '356938035643809',
    description:
      'The real IMEI or serial number, printed as readable text only',
  })
  identifier!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '185000.00',
    description:
      'The unit selling price, else the product selling price; null when ' +
      'neither is set',
  })
  selling_price!: string | null;

  @ApiProperty({ type: () => LabelBranchDto })
  branch!: LabelBranchDto;
}

/** One label row of either kind; narrow it on `kind`. */
export type LabelRow = ProductLabelRowDto | UnitLabelRowDto;
