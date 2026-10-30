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
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from './enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

/**
 * Admin-only user management. Create, deactivate and reactivate are not
 * @Auditable: the service writes their audit rows in the same transaction
 * as the change (the interceptor writes after the response, and can lose
 * the row).
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
      'Admin-only. Admins have no branch; managers and cashiers need an ' +
      'active one. Role defaults to cashier. Writes a CREATE audit entry ' +
      '(never the password).',
  })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or branch missing, inactive or not allowed',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 409, description: 'Email is already registered' })
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
      'Admin-only. Partially updates the user with the given UUID. Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
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
