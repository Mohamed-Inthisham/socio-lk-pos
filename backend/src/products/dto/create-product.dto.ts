import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsEnum,
  IsNumberString,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '../enums/product-type.enum';
import { BarcodeType } from '../enums/barcode-type.enum';
import { PhoneCondition } from '../enums/phone-condition.enum';
import { WarrantyPeriod } from '../enums/warranty-period.enum';

export class CreateProductDto {
  @ApiProperty({
    enum: ProductType,
    example: ProductType.PHONE,
    description: 'Broad product category. Determines type-specific fields.',
  })
  @IsEnum(ProductType, {
    message: `product_type must be one of: ${Object.values(ProductType).join(', ')}`,
  })
  product_type!: ProductType;

  @ApiProperty({
    example: 'iPhone 15 Pro Max',
    description: 'Product display name',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    example: '194252056387',
    description:
      'Manufacturer barcode. Optional — if omitted, an SLP-XXXXXX barcode ' +
      'is auto-generated. If provided, must be unique across the catalog.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({
    enum: BarcodeType,
    example: BarcodeType.CODE_128,
    description: 'Barcode symbology. Defaults to CODE_128.',
  })
  @IsOptional()
  @IsEnum(BarcodeType)
  barcode_type?: BarcodeType;

  @ApiProperty({
    example: 'a3f2c8d0-1234-5678-9abc-def012345678',
    description: 'Brand UUID (must be an active brand)',
    format: 'uuid',
  })
  @IsUUID()
  brand_id!: string;

  @ApiProperty({
    example: 'b4e3d9e1-2345-6789-abcd-ef1234567890',
    description: 'Category UUID (must be an active category)',
    format: 'uuid',
  })
  @IsUUID()
  category_id!: string;

  @ApiProperty({
    example: 'c5f4e0f2-3456-789a-bcde-f23456789012',
    description: 'Branch UUID (must be an active branch)',
    format: 'uuid',
  })
  @IsUUID()
  branch_id!: string;

  @ApiPropertyOptional({
    example: 'Latest flagship iPhone with titanium build',
    description: 'Free-form product description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: '180000.00',
    description: 'Buying price (LKR). Two decimal places. Non-negative.',
  })
  @IsNumberString(
    { no_symbols: false },
    {
      message: 'buying_price must be a numeric string (e.g. "180000.00")',
    },
  )
  buying_price!: string;

  @ApiProperty({
    example: '199900.00',
    description: 'Selling price (LKR). Two decimal places. Non-negative.',
  })
  @IsNumberString(
    { no_symbols: false },
    {
      message: 'selling_price must be a numeric string (e.g. "199900.00")',
    },
  )
  selling_price!: string;

  // ValidateIf (not IsOptional): omitted is fine (CHECKING on create,
  // unchanged on update), null is rejected — there is no "no warranty"
  // besides CHECKING.
  @ApiPropertyOptional({
    enum: WarrantyPeriod,
    example: WarrantyPeriod.MONTH_12,
    description:
      'The warranty a sale line of this product starts with (P5-18); the ' +
      'cashier can change it per line. CHECKING = the customer checks it ' +
      'in the shop, no warranty after. Defaults to CHECKING.',
  })
  @ValidateIf((o: CreateProductDto) => o.default_warranty !== undefined)
  @IsEnum(WarrantyPeriod, {
    message: `default_warranty must be one of: ${Object.values(WarrantyPeriod).join(', ')}`,
  })
  default_warranty?: WarrantyPeriod;

  @ApiPropertyOptional({
    example: true,
    description:
      'If true, the cashier must enter an IMEI/serial per unit at sale time. ' +
      'Typical for phones. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean()
  is_serialized?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the product is active. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  // ---- Phone-specific fields ----
  // All optional. UI enforces which of these are meaningful when
  // product_type = 'PHONE'; the API does not block missing values.

  @ApiPropertyOptional({
    enum: PhoneCondition,
    example: PhoneCondition.NEW,
    description: 'New or used. Meaningful only when product_type = PHONE.',
  })
  @IsOptional()
  @IsEnum(PhoneCondition)
  phone_condition?: PhoneCondition;

  @ApiPropertyOptional({
    example: 'A2848',
    description: 'Manufacturer model number. Meaningful for phones.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone_model?: string;

  @ApiPropertyOptional({
    example: '256GB',
    description: 'Storage capacity. Meaningful for phones.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone_storage?: string;

  @ApiPropertyOptional({
    example: 'Natural Titanium',
    description: 'Color. Meaningful for phones.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone_color?: string;

  @ApiPropertyOptional({
    example: '8GB',
    description: 'RAM. Meaningful for phones.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone_ram?: string;
}
