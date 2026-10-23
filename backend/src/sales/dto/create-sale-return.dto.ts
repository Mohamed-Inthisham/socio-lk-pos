import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApprovalDto } from '../../approvals/dto/approval.dto';
import { PaymentMethod } from '../enums/payment-method.enum';
import { ReturnCondition } from '../enums/return-condition.enum';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimmedOrNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/**
 * A refund's fields follow its method (Phase 6.4 P7-4, P7-31): CASH takes
 * neither original_payment_id nor reference_number; any other method
 * needs both, the payment it goes back to and the reversal's reference.
 * Whether that payment fits (this sale's, not TRADE_IN, same method) is
 * the service's check (R11).
 */
@ValidatorConstraint({ name: 'refundFieldsForMethod' })
class RefundFieldsForMethod implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const refund = args.object as RefundDto;
    const hasPayment = refund.original_payment_id != null;
    const hasReference = refund.reference_number != null;
    return refund.method === PaymentMethod.CASH
      ? !hasPayment && !hasReference
      : hasPayment && hasReference;
  }

  defaultMessage(args: ValidationArguments): string {
    const refund = args.object as RefundDto;
    return refund.method === PaymentMethod.CASH
      ? 'a CASH refund takes no original_payment_id or reference_number'
      : 'a non-cash refund needs original_payment_id (the payment it goes ' +
          "back to) and reference_number (the reversal's reference)";
  }
}

/** One sale line coming back. */
export class ReturnLineDto {
  @ApiProperty({ description: 'A line of this sale.', format: 'uuid' })
  @IsUUID(undefined, { message: 'sale_line_id must be a UUID' })
  sale_line_id!: string;

  @ApiProperty({
    description: 'How many units come back: at least 1, at most what is left.',
    minimum: 1,
    example: 1,
  })
  @IsInt({ message: 'quantity must be a whole number' })
  @Min(1, { message: 'quantity must be at least 1' })
  quantity!: number;

  @ApiPropertyOptional({
    enum: ReturnCondition,
    description:
      'Required for a non-phone line from our stock with stock tracking ' +
      '(RESALEABLE → back to stock, DAMAGED → not); refused for phones, ' +
      "another shop's lines and untracked products (400 " +
      'RETURN_CONDITION_INVALID).',
  })
  @IsOptional()
  @IsEnum(ReturnCondition, {
    message: 'condition must be RESALEABLE or DAMAGED',
  })
  condition?: ReturnCondition;
}

/** Money going back. */
export class RefundDto {
  @ApiProperty({
    enum: PaymentMethod,
    description:
      'CASH, or the method of the non-cash payment it goes back to. ' +
      'TRADE_IN is refused (400 REFUND_METHOD_NOT_ALLOWED).',
  })
  @IsEnum(PaymentMethod, { message: 'method must be a payment method' })
  @Validate(RefundFieldsForMethod)
  method!: PaymentMethod;

  @ApiProperty({ minimum: 0.01, example: 966.67 })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'amount must be a number with at most 2 decimals' },
  )
  @Min(0.01, { message: 'amount must be at least 0.01' })
  amount!: number;

  @ApiPropertyOptional({
    description: 'Non-cash only: the payment of this sale it goes back to.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'original_payment_id must be a UUID' })
  original_payment_id?: string | null;

  @ApiPropertyOptional({
    description:
      'Non-cash only: the reference of the reversal done on the card ' +
      'machine or provider portal.',
    maxLength: 100,
  })
  @Transform(trimmedOrNull)
  @IsOptional()
  @IsString({ message: 'reference_number must be a string' })
  @MaxLength(100, {
    message: 'reference_number must be at most 100 characters',
  })
  reference_number?: string | null;
}

/**
 * Request body for POST /sales/:id/returns (Phase 6.4 P7). Shape checks
 * only (R1); everything that needs the sale is the service's, in the
 * R-number order of the planning doc's error table. Messages name fields,
 * never values, so a PIN is never echoed.
 */
export class CreateSaleReturnDto {
  @ApiProperty({
    description:
      "The till's id for this return (one per return dialog, resent with " +
      'every attempt): a resend from the same sale and user gets the ' +
      'recorded return back (200), without a PIN check.',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'client_request_id must be a UUID' })
  client_request_id!: string;

  @ApiProperty({ type: [ReturnLineDto] })
  @IsArray({ message: 'lines must be an array' })
  @ArrayMinSize(1, { message: 'lines must have at least one line' })
  @ArrayMaxSize(200, { message: 'lines must have at most 200 lines' })
  @ArrayUnique((line: ReturnLineDto) => line?.sale_line_id, {
    message: 'lines must not repeat a sale_line_id',
  })
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @ApiProperty({
    type: [RefundDto],
    description: 'Empty only when nothing is refunded.',
  })
  @IsArray({ message: 'refunds must be an array' })
  @ArrayMaxSize(20, { message: 'refunds must have at most 20 rows' })
  @ValidateNested({ each: true })
  @Type(() => RefundDto)
  refunds!: RefundDto[];

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString({ message: 'reason must be a string' })
  @Transform(trimmed)
  @MinLength(3, {
    message: 'reason must be at least 3 characters after trimming',
  })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Required when a returned line is outside warranty (400 ' +
      'OVERRIDE_REASON_REQUIRED); ignored (stored null) otherwise.',
    minLength: 3,
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'override_reason must be a string' })
  @Transform(trimmed)
  @MinLength(3, {
    message: 'override_reason must be at least 3 characters after trimming',
  })
  @MaxLength(500, { message: 'override_reason must be at most 500 characters' })
  override_reason?: string;

  @ApiProperty({
    description:
      "Required on every return: the approving admin or manager and their PIN (may be the session user's own).",
    type: ApprovalDto,
  })
  @IsDefined({
    message:
      "approval is required: a manager's or admin's PIN approves every return",
  })
  @ValidateNested()
  @Type(() => ApprovalDto)
  approval!: ApprovalDto;
}
