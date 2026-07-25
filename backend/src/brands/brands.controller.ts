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
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Brands')
@ApiCookieAuth('access_token')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List brands',
    description:
      'All authenticated roles can list active brands (needed for product filtering ' +
      'in cashier UI). Pass includeInactive=true to include deactivated brands.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Include deactivated brands (admin UI toggle)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of brands (sorted alphabetically)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.brandsService.findAll(includeInactive ?? false);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get a brand by ID',
    description: 'All authenticated roles can view a brand by ID.',
  })
  @ApiParam({ name: 'id', description: 'Brand UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Brand found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Brand not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Brand', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a new brand',
    description:
      'Admin-only. Brand names are case-insensitively unique — creating "apple" ' +
      'when "Apple" exists returns 409 Conflict.',
  })
  @ApiResponse({ status: 201, description: 'Brand created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 409, description: 'Brand name already exists' })
  async create(@Body() dto: CreateBrandDto) {
    return this.brandsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Brand', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a brand',
    description:
      'Admin-only. Partially updates the brand. Renaming to an existing name ' +
      '(case-insensitive) returns 409 Conflict.',
  })
  @ApiParam({ name: 'id', description: 'Brand UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Brand updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Brand not found' })
  @ApiResponse({ status: 409, description: 'Brand name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Brand', AuditAction.DEACTIVATE)
  @ApiOperation({
    summary: 'Deactivate a brand',
    description:
      'Admin-only. Sets is_active=false. Brands referenced by products can still ' +
      'be viewed on those products; the deactivation only hides them from active ' +
      'brand pickers. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Brand UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Brand deactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Brand not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @Auditable('Brand', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Reactivate a deactivated brand',
    description: 'Admin-only. Sets is_active=true. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Brand UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Brand reactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Brand not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandsService.reactivate(id);
  }
}
