import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

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

  // Not @Auditable: passInspection writes the INSPECTION_PASSED row in
  // its own transaction.
  @Post(':id/inspection-pass')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Pass a returned phone after inspection (back to stock)',
    description:
      'Phase 6.4 P7-7. A phone a customer returned waits in INSPECTION ' +
      '(held, not sellable). When it is checked and has no fault, this ' +
      'moves it to IN_STOCK and adds 1 to its stock, in one transaction ' +
      '(Stock row, then the unit, in the global lock order), and writes ' +
      'an INSPECTION_PASSED audit row. A faulty phone stays in INSPECTION ' +
      'until the supplier-receiving phase.\n\n' +
      'Admins at any branch; managers only for a unit at their own branch.',
  })
  @ApiParam({ name: 'id', description: 'ProductUnit UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Passed; the unit as GET /product-units/:id returns it',
  })
  @ApiResponse({ status: 400, description: 'Malformed id' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      'A cashier, or { message, code: INSPECTION_WRONG_BRANCH } for a ' +
      'manager of another branch',
  })
  @ApiResponse({ status: 404, description: 'Product unit not found' })
  @ApiResponse({
    status: 409,
    description:
      '{ message, code: NOT_IN_INSPECTION, status }: the unit is not ' +
      'waiting for inspection',
  })
  async passInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.productUnitsService.passInspection(id, user, ip);
  }
}
