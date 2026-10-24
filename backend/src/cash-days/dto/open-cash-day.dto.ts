import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Max, Min } from 'class-validator';

/**
 * Request body for POST /cash-days/open (Phase 6.4 P9-7). Shape checks
 * only (C1); the branch, today and earlier days are the service's.
 */
export class OpenCashDayDto {
  @ApiProperty({
    description:
      'The branch. Managers and cashiers: their own; admins: any (403 ' +
      'CASH_DAY_WRONG_BRANCH).',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'branch_id must be a UUID' })
  branch_id!: string;

  @ApiProperty({
    description:
      'The cash in the box at opening: a number, at least 0, at most 2 decimals.',
    minimum: 0,
    example: 5000,
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'opening_balance must be a number with at most 2 decimals' },
  )
  @Min(0, { message: 'opening_balance must be at least 0' })
  @Max(9999999999.99, {
    message: 'opening_balance must be at most 9999999999.99',
  })
  opening_balance!: number;

  @ApiProperty({
    description:
      "The till's id for this opening (one per dialog, resent with every " +
      'attempt, P9-18): a resend from the same user for the same branch ' +
      'gets the recorded day back (200).',
    format: 'uuid',
  })
  @IsUUID(undefined, { message: 'client_request_id must be a UUID' })
  client_request_id!: string;
}
