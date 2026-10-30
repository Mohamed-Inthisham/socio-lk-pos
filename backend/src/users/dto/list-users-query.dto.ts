import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../enums/user-role.enum';

/**
 * Query params for GET /users (admin only).
 *
 * Extends PaginationQueryDto (codebase convention) → inherits page/limit
 * (default 1 / 50, max limit 200).
 *
 * Filters (all optional, combined with AND):
 * - search: case-insensitive substring match on full name, email, NIC or
 *   contact number; a search that is a Sri Lankan number also finds its
 *   stored 0XXXXXXXXX form.
 *   Trimmed first; empty/whitespace-only is treated as absent.
 * - role: admin | manager | cashier.
 * - branchId: the user's branch (admins have none, so never match).
 * - isActive: "true" | "false". Omitted returns both.
 *
 * Soft-deleted users are never listed.
 */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on full name, email, NIC or ' +
      'contact number (+94 numbers also match their 0XXXXXXXXX form). ' +
      'Trimmed; empty is ignored.',
    example: 'perera',
    maxLength: 100,
  })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(UserRole, {
    message: `role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Filter by branch', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'true: only active users; false: only deactivated users',
    type: Boolean,
    example: true,
  })
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
