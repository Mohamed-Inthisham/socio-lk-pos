import { TrackingMethod } from '../enums/tracking-method.enum';
import {
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsEnum,
  IsNumberString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '../enums/product-type.enum';
import { BarcodeType } from '../enums/barcode-type.enum';
import { PhoneCondition } from '../enums/phone-condition.enum';
import { WarrantyPeriod } from '../enums/warranty-period.enum';
import { IsOptionalNotNull } from '../../common/validators/is-optional-not-null.decorator';

export class CreateProductDto {
  @ApiPropertyOptional({
    deprecated: true,
    enum: ProductType,
    example: ProductType.PHONE,
    description: 'Legacy classification. Use category_id.',
  })
  @IsOptional()
  @IsEnum(ProductType, {
    message: `product_type must be one of: ${Object.values(ProductType).join(', ')}`,
  })
  product_type?: ProductType;

  @ApiPropertyOptional({
    enum: TrackingMethod,
    description:
      'Tracking used when stock is received. Defaults to the category setting. No individual identifier is entered on a product.',
  })
  @IsOptionalNotNull()
  @IsEnum(TrackingMethod)
  tracking_method?: TrackingMethod;

  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Model name or number for any product. Individual IMEI and serial numbers are entered during stock receiving (GRN).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({
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
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({
    enum: BarcodeType,
    example: BarcodeType.CODE_128,
    description: 'Barcode symbology. Defaults to CODE_128.',
  })
  @IsOptionalNotNull()
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

  @ApiPropertyOptional({
    example: 'c5f4e0f2-3456-789a-bcde-f23456789012',
    description: 'Legacy branch association. New catalog products are global; stock is assigned to a branch when received.',
    format: 'uuid',
  })
  @IsOptionalNotNull()
  @IsUUID()
  branch_id?: string;

  @ApiPropertyOptional({
    example: 'Latest flagship iPhone with titanium build',
    description: 'Free-form product description',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: '180000.00',
    description: 'Legacy product cost. New purchase costs are recorded during stock receiving.',
  })
  @IsOptional()
  @IsNumberString(
    { no_symbols: false },
    {
      message: 'buying_price must be a numeric string (e.g. "180000.00")',
    },
  )
  buying_price?: string;

  @ApiPropertyOptional({
    example: '199900.00',
    description: 'Optional current selling price (LKR). Can be set later.',
  })
  @IsOptionalNotNull()
  @IsNumberString(
    { no_symbols: false },
    {
      message: 'selling_price must be a numeric string (e.g. "199900.00")',
    },
  )
  selling_price?: string;

  // Omitted is fine (NO_WARRANTY on create); null is rejected — NO_WARRANTY
  // is the explicit "no warranty".
  @ApiPropertyOptional({
    enum: WarrantyPeriod,
    example: WarrantyPeriod.MONTH_12,
    description:
      'The warranty a sale line of this product starts with (P5-18); the ' +
      'cashier can change it per line. NO_WARRANTY = sold without one; ' +
      'CHECKING = the customer checks it in the shop, no warranty after. ' +
      'Defaults to NO_WARRANTY (P5-19).',
  })
  @IsOptionalNotNull()
  @IsEnum(WarrantyPeriod, {
    message: `default_warranty must be one of: ${Object.values(WarrantyPeriod).join(', ')}`,
  })
  default_warranty?: WarrantyPeriod;

  @ApiPropertyOptional({
    deprecated: true,
    example: true,
    description:
      'Legacy compatibility flag. Prefer tracking_method. True means IMEI tracking; false means no IMEI prompt at the till. ' +
      'Defaults to false.',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  is_serialized?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the product is active. Defaults to true.',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  is_active?: boolean;

  // ---- Phone-specific fields ----
  // Optional specifications enabled through category settings.

  @ApiPropertyOptional({
    enum: PhoneCondition,
    example: PhoneCondition.NEW,
    description:
      'New or used. Available for categories with phone specifications enabled.',
  })
  @IsOptional()
  @IsEnum(PhoneCondition)
  phone_condition?: PhoneCondition;

  @ApiPropertyOptional({
    deprecated: true,
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
