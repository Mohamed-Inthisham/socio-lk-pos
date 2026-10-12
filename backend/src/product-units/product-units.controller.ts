import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProductUnitsService } from './product-units.service';
import { ListProductUnitsQueryDto } from './dto/list-product-units-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';

@ApiTags('Product Units')
@ApiCookieAuth('access_token')
@Controller('product-units')
export class ProductUnitsController {
  constructor(private readonly productUnitsService: ProductUnitsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List product units (paginated, filterable)',
    description:
      'Admin/Manager only — cashiers do not have a browse-units use ' +
      'case yet (they interact with ProductUnits implicitly via IMEI ' +
      'at ring-up in Slice E). Filters: productId, branchId, status, ' +
      'imei (exact match). Pagination: page (default 1), limit ' +
      '(default 50, max 200). Sorted by created_at DESC.\n\n' +
      'Multi-branch scoping ("only my branch") deferred to R9, ' +
      'matching Sales precedent — managers can currently see all ' +
      'units. Frontend can pass branchId explicitly when the UX ' +
      'wants scoping.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of product units with nested product, branch, ' +
      'and phone_purchase (with customer). Shape: { data: ProductUnit[], ' +
      'meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cashier attempted to browse product units',
  })
  async findAll(@Query() query: ListProductUnitsQueryDto) {
    return this.productUnitsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Get a product unit by ID (with nested product, branch, and ' +
      'phone_purchase)',
    description:
      'Admin/Manager only. Returns the unit with product, branch, and ' +
      'phone_purchase (including its customer) eagerly loaded.',
  })
  @ApiParam({ name: 'id', description: 'ProductUnit UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product unit found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cashier attempted to view a product unit',
  })
  @ApiResponse({ status: 404, description: 'Product unit not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productUnitsService.findOne(id);
  }
}
