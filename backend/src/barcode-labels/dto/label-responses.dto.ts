import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  PaginatedResponse,
  PaginationMeta,
} from '../../common/dto/paginated-response.dto';
import {
  LabelKind,
  ProductLabelRowDto,
  UnitLabelRowDto,
} from './label-row.dto';

/**
 * Response shapes for the Barcode Labels endpoints (Stage 2). The searches
 * use the codebase's { data, meta } pagination (paginate()); the resolved
 * queue is not paginated, as it is printed as one sheet.
 */

/** A page of product labels, for picking QUANTITY-tracked products. */
export class ProductLabelSearchResponseDto implements PaginatedResponse<ProductLabelRowDto> {
  @ApiProperty({ type: () => [ProductLabelRowDto] })
  data!: ProductLabelRowDto[];

  @ApiProperty({ type: () => PaginationMeta })
  meta!: PaginationMeta;
}

/** A page of unit labels, for picking individual IMEI or serial units. */
export class UnitLabelSearchResponseDto implements PaginatedResponse<UnitLabelRowDto> {
  @ApiProperty({ type: () => [UnitLabelRowDto] })
  data!: UnitLabelRowDto[];

  @ApiProperty({ type: () => PaginationMeta })
  meta!: PaginationMeta;
}

/**
 * A product in the resolved queue: its label, printed `quantity` times. The
 * row is sent once rather than repeated, since one product can ask for many
 * copies.
 */
export class ResolvedProductQueueItemDto extends ProductLabelRowDto {
  @ApiProperty({
    minimum: 1,
    example: 3,
    description: 'How many copies of this label to print',
  })
  quantity!: number;
}

/** A unit in the resolved queue: always exactly one label. */
export class ResolvedUnitQueueItemDto extends UnitLabelRowDto {}

/** One item of the resolved queue; narrow it on `kind`. */
export type ResolvedQueueItem =
  | ResolvedProductQueueItemDto
  | ResolvedUnitQueueItemDto;

/**
 * The label queue, resolved and checked: PRODUCT and UNIT items mixed, in
 * the order they were requested, with each product and each unit at most
 * once.
 */
@ApiExtraModels(ResolvedProductQueueItemDto, ResolvedUnitQueueItemDto)
export class ResolvedLabelQueueResponseDto {
  @ApiProperty({
    description: 'Items in the requested order',
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ResolvedProductQueueItemDto) },
        { $ref: getSchemaPath(ResolvedUnitQueueItemDto) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          [LabelKind.PRODUCT]: getSchemaPath(ResolvedProductQueueItemDto),
          [LabelKind.UNIT]: getSchemaPath(ResolvedUnitQueueItemDto),
        },
      },
    },
  })
  data!: ResolvedQueueItem[];

  @ApiProperty({
    minimum: 0,
    example: 5,
    description:
      'Labels the sheet will hold: each product quantity, plus one per unit',
  })
  total_labels!: number;
}
