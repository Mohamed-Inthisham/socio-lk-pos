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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Suppliers')
@ApiCookieAuth('access_token')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List suppliers',
    description:
      'All authenticated roles can list active suppliers (needed for external ' +
      'sourcing confirmation in the POS UI). Pass includeInactive=true to include ' +
      'deactivated suppliers.',
  })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'Include deactivated suppliers (admin UI toggle)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of suppliers (sorted alphabetically)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.suppliersService.findAll(includeInactive ?? false);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get a supplier by ID',
    description: 'All authenticated roles can view a supplier by ID.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Supplier found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.findOne(id);
  }

  @Get(':id/sales-count')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get the number of sale lines referencing this supplier',
    description:
      'Admin-only. Used by the frontend to show "cannot deactivate, has X sales" ' +
      'context on the supplier admin page, and by the 6.7 settlement flow. ' +
      'Currently returns {count: 0} — real query lands in Slice H1 after Sales.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Sales count for the supplier',
    schema: {
      type: 'object',
      properties: { count: { type: 'integer', example: 0 } },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async getSalesCount(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.getSalesCount(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Supplier', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a new supplier',
    description:
      'Admin-only. Supplier names are case-insensitively unique — creating ' +
      '"ranjith mobile" when "Ranjith Mobile" exists returns 409 Conflict.',
  })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 409, description: 'Supplier name already exists' })
  async create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Supplier', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a supplier',
    description:
      'Admin-only. Partially updates the supplier. Renaming to an existing ' +
      'name (case-insensitive) returns 409 Conflict. Empty strings on optional ' +
      'fields clear them to null.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Supplier updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @ApiResponse({ status: 409, description: 'Supplier name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Supplier', AuditAction.DEACTIVATE)
  @ApiOperation({
    summary: 'Deactivate a supplier',
    description:
      'Admin-only. Sets is_active=false. Suppliers referenced by sale lines ' +
      'remain visible on those sales; deactivation only hides them from active ' +
      'supplier pickers. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Supplier deactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @Auditable('Supplier', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Reactivate a deactivated supplier',
    description: 'Admin-only. Sets is_active=true. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Supplier reactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliersService.reactivate(id);
  }
}
