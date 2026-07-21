import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
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
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
