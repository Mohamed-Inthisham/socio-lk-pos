import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum';

/**
 * Body of PATCH /users/:id/role. The role is required; the branch follows
 * the same rule as on create (UsersService.resolveBranchForRole):
 *   - admin           → branch_id omitted or null
 *   - manager/cashier → branch_id required, an active branch
 * Also how a staff user moves branch while keeping their role.
 */
export class ChangeRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER })
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role!: UserRole;

  @ApiPropertyOptional({
    example: 'c5f4e0f2-3456-789a-bcde-f23456789012',
    description:
      'Branch UUID. REQUIRED for manager and cashier, omitted or null for admin.',
    format: 'uuid',
    nullable: true,
  })
  // @IsOptional lets null through on purpose: null is how a client says
  // "no branch" for an admin; the service refuses it for staff.
  @IsOptional()
  @IsUUID(undefined, { message: 'branch_id must be a valid UUID' })
  branch_id?: string | null;
}
