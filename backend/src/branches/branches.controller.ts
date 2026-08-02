import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseBoolPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Branches')
@ApiCookieAuth('access_token')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List branches',
    description:
      'All authenticated roles can list active branches (needed for receipt header, ' +
      'admin dropdown, etc.). Pass includeInactive=true (admin UI) to include ' +
      'deactivated branches. ' +
      "Note: scoping to caller's branch is deferred to R9 (multi-branch launch); " +
      'for now all roles see all branches. See GET /branches/:id for the scoped pattern.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description:
      'Include deactivated branches in the response (admin UI toggle)',
  })
  @ApiResponse({ status: 200, description: 'List of branches' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.branchesService.findAll(includeInactive ?? false);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get a branch by ID',
    description:
      'Admin can fetch any branch. Manager and cashier can only fetch their own ' +
      'assigned branch (returns 403 otherwise). Used by cashier UI to load ' +
      'receipt header info for their own shop.',
  })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Staff attempted to read a branch other than their own',
  })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Branch scoping (first appearance of the pattern):
    //   - Admin: unrestricted (branch_id is null anyway)
    //   - Manager/cashier: locked to their own branch
    // DB invariant guarantees non-admins always have a non-null branch_id,
    // so we can compare directly without a null-check on user.branch_id.
    if (user.role !== UserRole.ADMIN && user.branch_id !== id) {
      throw new ForbiddenException('You can only view your own branch');
    }
    return this.branchesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Branch', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a new branch',
    description:
      'Admin-only. Creates a new branch and writes an audit log entry.',
  })
  @ApiResponse({ status: 201, description: 'Branch created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  async create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Branch', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a branch',
    description:
      'Admin-only. Partially updates the branch. ' +
      'If is_active transitions true → false, enforces the invariant that ' +
      'at least one branch must remain active. Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch updated' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed or attempted to deactivate the last active branch',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Branch', AuditAction.DEACTIVATE)
  @ApiOperation({
    summary: 'Deactivate a branch',
    description:
      'Admin-only. Sets is_active=false rather than hard-deleting, because ' +
      'branches are referenced by products, stock, sales, and users. ' +
      'Returns the deactivated branch. ' +
      'Rejects if this is the last active branch. Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch deactivated' })
  @ApiResponse({
    status: 400,
    description: 'Cannot deactivate the last active branch',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @Auditable('Branch', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Reactivate a deactivated branch',
    description: 'Admin-only. Sets is_active=true. Writes an audit log entry.',
  })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch reactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.reactivate(id);
  }
}
