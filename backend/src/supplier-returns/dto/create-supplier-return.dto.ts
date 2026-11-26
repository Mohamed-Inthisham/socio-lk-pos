import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SupplierReturnReason } from '../enums/supplier-return-reason.enum';

const trimNote = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSupplierReturnLineDto {
  @IsUUID()
  stock_purchase_item_id!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  product_unit_ids?: string[];
}

@ValidatorConstraint({ name: 'supplierReturnLinesAreConsistent', async: false })
class SupplierReturnLinesAreConsistent implements ValidatorConstraintInterface {
  validate(lines: CreateSupplierReturnLineDto[]): boolean {
    if (!Array.isArray(lines)) return false;

    const purchaseItemIds = new Set<string>();
    const productUnitIds = new Set<string>();
    for (const line of lines) {
      if (!line || typeof line !== 'object' || Array.isArray(line))
        return false;

      const purchaseItemId = line.stock_purchase_item_id;
      if (typeof purchaseItemId === 'string') {
        const canonicalPurchaseItemId = purchaseItemId.toLowerCase();
        if (purchaseItemIds.has(canonicalPurchaseItemId)) return false;
        purchaseItemIds.add(canonicalPurchaseItemId);
      }

      const unitIds = line.product_unit_ids ?? [];
      if (!Array.isArray(unitIds)) return false;
      if (unitIds.length > line.quantity) return false;
      for (const unitId of unitIds) {
        if (typeof unitId !== 'string') continue;
        const canonicalUnitId = unitId.toLowerCase();
        if (productUnitIds.has(canonicalUnitId)) return false;
        productUnitIds.add(canonicalUnitId);
      }
    }
    return true;
  }

  defaultMessage(): string {
    return 'Return lines must use distinct purchase items and units, and the unit count cannot exceed the line quantity.';
  }
}

export class CreateSupplierReturnDto {
  @IsUUID()
  client_request_id!: string;

  @IsUUID()
  stock_purchase_id!: string;

  @IsEnum(SupplierReturnReason)
  reason_code!: SupplierReturnReason;

  @Transform(({ value }) => trimNote(value))
  @ValidateIf(
    (dto: CreateSupplierReturnDto, value: unknown) =>
      dto.reason_code === SupplierReturnReason.OTHER ||
      (value !== undefined && value !== null),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Validate(SupplierReturnLinesAreConsistent)
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierReturnLineDto)
  items!: CreateSupplierReturnLineDto[];
}
