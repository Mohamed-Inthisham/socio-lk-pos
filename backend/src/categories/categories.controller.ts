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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Categories')
@ApiCookieAuth('access_token')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List categories (flat)',
    description:
      'Returns all active categories in a flat list, sorted by sort_order ASC then ' +
      'name ASC. The frontend groups them by parent_id to display the two-level tree.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Include deactivated categories (admin UI toggle)',
  })
  @ApiResponse({ status: 200, description: 'List of categories' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.categoriesService.findAll(includeInactive ?? false);
  }

  @Get('top-level')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List only top-level categories',
    description:
      'Useful for the parent picker when creating a child category — only ' +
      'top-level categories are valid parents in a two-level hierarchy.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
  })
  @ApiResponse({ status: 200, description: 'List of top-level categories' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findTopLevel(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.categoriesService.findTopLevel(includeInactive ?? false);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Get a category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Category', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a new category',
    description:
      'Admin-only. Category names are case-insensitively unique within the same ' +
      'parent. Categories can only be nested two levels deep.',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or parent is not top-level',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({
    status: 409,
    description: 'Category name already exists at this level',
  })
  async create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Category', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a category',
    description:
      'Admin-only. Enforces the two-level rule on parent changes and case-insensitive ' +
      'uniqueness among new siblings. Cannot set parent_id to self.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, parent is not top-level, self-parent attempt, or would create three-level nesting',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description: 'Category name already exists at this level',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Category', AuditAction.DEACTIVATE)
  @ApiOperation({
    summary: 'Deactivate a category',
    description:
      'Admin-only. Sets is_active=false. Does not affect child categories — they ' +
      'have independent lifecycle. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category deactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @Auditable('Category', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Reactivate a deactivated category',
    description: 'Admin-only. Sets is_active=true. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Category UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category reactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.reactivate(id);
  }
}
