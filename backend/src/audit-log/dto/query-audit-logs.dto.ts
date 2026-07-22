import {
  IsOptional,
  IsUUID,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '../enums/audit-action.enum';

export class QueryAuditLogsDto {
  @ApiPropertyOptional({
    description: 'Filter by acting user (UUID)',
    example: 'a3e11b4d-2ff9-4d63-8f4b-3d6d9c5f8e7a',
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({
    description: 'Filter by entity type (e.g. "User", "Product")',
    example: 'User',
  })
  @IsOptional()
  @IsString()
  entity_type?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific entity ID',
    example: 'b7c22a5e-3ee8-4a71-9c5d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsString()
  entity_id?: string;

  @ApiPropertyOptional({
    enum: AuditAction,
    description: 'Filter by action type',
    example: AuditAction.UPDATE,
  })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'Filter logs created on or after this date (ISO-8601)',
    example: '2026-07-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Filter logs created on or before this date (ISO-8601)',
    example: '2026-07-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Results per page (max 100)',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
