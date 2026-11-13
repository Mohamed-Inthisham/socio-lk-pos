import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { LabelKind } from './label-row.dto';

/** The most labels one resolved queue (one print run) may hold. */
export const MAX_LABELS_PER_QUEUE = 500;

/**
 * 400 unless the item's `type` is `kind`: productId and quantity belong to
 * PRODUCT items, unitId to UNIT items. Used with a ValidateIf that runs it
 * whenever the field is sent, so a field on the wrong kind of item is
 * refused rather than silently ignored.
 */
const OnlyOnType = (kind: LabelKind): PropertyDecorator =>
  ValidateBy({
    name: 'onlyOnType',
    constraints: [kind],
    validator: {
      validate: (_value: unknown, args?: ValidationArguments): boolean =>
        (args?.object as { type?: unknown } | undefined)?.type === kind,
      defaultMessage: (args?: ValidationArguments): string =>
        `${args?.property ?? 'This field'} is only allowed on ${kind} items`,
    },
  });

type ItemFields = {
  type?: unknown;
  productId?: unknown;
  quantity?: unknown;
  unitId?: unknown;
};

/** Validate the field when its kind of item needs it, or whenever sent. */
const forKindOrSent =
  (kind: LabelKind, field: keyof ItemFields) =>
  (item: ItemFields): boolean =>
    item.type === kind || item[field] !== undefined;

/**
 * One queue item. A flat class rather than one class per type: a
 * class-transformer discriminator throws a 500 on a null or non-object array
 * element, before validation runs; here such an element is a 400.
 *
 * - PRODUCT: productId and quantity (1–500) are required; unitId is refused.
 * - UNIT: unitId is required; productId and quantity are refused, since a
 *   unit is one physical item and always one label.
 */
export class LabelQueueItemDto {
  @ApiProperty({
    enum: LabelKind,
    example: LabelKind.PRODUCT,
    description:
      'PRODUCT: a product-level label for a QUANTITY-tracked product, ' +
      'printed `quantity` times. UNIT: one label for one IMEI- or ' +
      'serial-tracked unit.',
  })
  @IsEnum(LabelKind)
  type!: LabelKind;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '33333333-3333-3333-3333-333333333333',
    description: 'PRODUCT items only (required there)',
  })
  @ValidateIf(forKindOrSent(LabelKind.PRODUCT, 'productId'))
  @IsUUID()
  @OnlyOnType(LabelKind.PRODUCT)
  productId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LABELS_PER_QUEUE,
    example: 2,
    description:
      'PRODUCT items only (required there): copies of the label, a whole ' +
      `number from 1 to ${MAX_LABELS_PER_QUEUE}`,
  })
  @ValidateIf(forKindOrSent(LabelKind.PRODUCT, 'quantity'))
  @IsInt()
  @Min(1)
  @Max(MAX_LABELS_PER_QUEUE)
  @OnlyOnType(LabelKind.PRODUCT)
  quantity?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
    description: 'UNIT items only (required there)',
  })
  @ValidateIf(forKindOrSent(LabelKind.UNIT, 'unitId'))
  @IsUUID()
  @OnlyOnType(LabelKind.UNIT)
  unitId?: string;
}

/**
 * Body of POST /barcode-labels/resolve: the label queue to check and turn
 * into label rows, in order.
 *
 * Every item gives at least one label, so more than 500 items is refused
 * here; the 500-label total across product quantities is checked by the
 * service.
 */
export class ResolveLabelQueueDto {
  @ApiPropertyOptional({
    example: '11111111-1111-1111-1111-111111111111',
    format: 'uuid',
    description:
      'The branch whose units may be printed. Admins: any, or every branch ' +
      'when left out. Managers: their own branch either way; another is ' +
      '403 WRONG_BRANCH. Products are not branch-specific.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({
    type: () => [LabelQueueItemDto],
    minItems: 1,
    maxItems: MAX_LABELS_PER_QUEUE,
    description:
      'The queue, in print order. Each product and each unit at most once.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LABELS_PER_QUEUE)
  @ValidateNested({ each: true })
  @Type(() => LabelQueueItemDto)
  items!: LabelQueueItemDto[];
}
