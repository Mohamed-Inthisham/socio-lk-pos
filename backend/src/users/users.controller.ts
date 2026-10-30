import {
  Controller,
  Get,
  Post,
  Param,
  Patch,
  Body,
  Query,
  Ip,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from './enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

/**
 * Admin-only user management. Create, role change, password reset,
 * deactivate and reactivate are not @Auditable: the service writes their audit rows in
 * the same transaction as the change (the interceptor writes after the
 * response, and can lose the row).
 */
@ApiTags('Users')
@ApiCookieAuth('access_token')
@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users (paginated, filterable)',
    description:
      'Admin-only. Filters: search (name or email), role, branchId, ' +
      'isActive. Ordered by full name. Soft-deleted users are left out. ' +
      'Never returns password or approval PIN hashes.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Shape: { data: User[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  async findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a user',
    description:
      'Admin-only. Contact number, NIC and address are required. Admins ' +
      'have no branch; managers and cashiers need an active one. Role ' +
      'defaults to cashier. Writes a CREATE audit entry (never the password).',
  })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or branch missing, inactive or not allowed',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({
    status: 409,
    description:
      'Email is already registered, or NIC already registered (code NIC_ALREADY_REGISTERED)',
  })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.usersService.create(dto, user, ip);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a user by ID',
    description: 'Admin-only. Returns the user with the given UUID.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Patch(':id')
  @Auditable('User', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Admin-only. Partially updates the user with the given UUID: name, ' +
      'email, contact number, NIC, address. Contact details can be changed ' +
      'but not cleared (null or empty is a 400). Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({
    status: 409,
    description:
      'Email is already registered, or NIC already registered (code NIC_ALREADY_REGISTERED)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: "Change a user's role and branch",
    description:
      'Admin-only. Admins have no branch (omit branch_id or send null); ' +
      'managers and cashiers need an active one. Also moves a staff user ' +
      'to another branch. Becoming a cashier clears the approval PIN. ' +
      "Revokes the user's refresh tokens; the new role applies to their " +
      'next request. Refused for your own account and for the last active ' +
      'admin. Returns the user. Writes a ROLE_CHANGED audit entry.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role changed (or unchanged)' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, branch missing, inactive or not allowed, or ' +
      '{ message, code: CANNOT_CHANGE_OWN_ROLE | LAST_ACTIVE_ADMIN }',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    await this.usersService.changeRole(id, dto, user, ip);
    return this.findOne(id);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Reset another user's password",
    description:
      'Admin-only. Sets a new password (at least 8 characters, at most 72 ' +
      "bytes in UTF-8) without the old one. Revokes the user's refresh " +
      'tokens. Works for inactive users. Refused for your own account (use ' +
      'PUT /auth/me/password). Writes a PASSWORD_RESET audit entry (never ' +
      'the password).',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Password reset' })
  @ApiResponse({
    status: 400,
    description:
      'Password too short or too long, or { message, code: CANNOT_RESET_OWN_PASSWORD }',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<void> {
    await this.usersService.resetPassword(id, dto, user, ip);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a user',
    description:
      'Admin-only. The user can no longer log in: their refresh tokens are ' +
      'revoked and their approval PIN cleared. Refused for your own ' +
      'account and for the last active admin. Returns the user. Writes a ' +
      'DEACTIVATE audit entry.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({
    status: 400,
    description:
      '{ message, code: CANNOT_DEACTIVATE_SELF | LAST_ACTIVE_ADMIN }',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    await this.usersService.deactivate(id, user, ip);
    return this.findOne(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a user',
    description:
      'Admin-only. The user can log in again with the same role and ' +
      'branch; earlier sessions stay revoked and the approval PIN stays ' +
      "cleared. A staff user's branch must be active. Returns the user. " +
      'Writes a REACTIVATE audit entry.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  @ApiResponse({ status: 400, description: "The user's branch is inactive" })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    await this.usersService.reactivate(id, user, ip);
    return this.findOne(id);
  }
}
