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
import { SearchProductUnitsQueryDto } from './dto/search-product-units-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { scopeBranch } from '../common/utils/branch-scope';

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
      'Branch scoping (Phase 2 P2-3): admins see every branch, or the ' +
      'one given in branchId; managers see only their own branch ' +
      '(branchId left out or their own), and another branchId is ' +
      '403 { code: WRONG_BRANCH }.',
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
    description:
      'Cashier attempted to browse product units, or { message, code: ' +
      'WRONG_BRANCH } for a manager asking for another branch',
  })
  async findAll(
    @Query() query: ListProductUnitsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productUnitsService.findAll({
      ...query,
      branchId: scopeBranch(user, query.branchId),
    });
  }

  // Before :id, which would otherwise take "search" for an id.
  @Get('search')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Search product units (paginated)',
    description:
      'Admin/Manager only (INV-F3). Partial, case-insensitive match of q on ' +
      'the IMEI, the legacy imei column, the serial number, and the ' +
      'product’s SKU and name; % and _ match themselves. Every status: each ' +
      'record of a bought-back phone is returned on its own, and there is no ' +
      'status filter. Sorted by created_at DESC, id DESC. Pagination: page ' +
      '(default 1), limit (default 50, max 200).\n\n' +
      'Carries no customer, sale or price: use this, not GET /product-units, ' +
      'to answer a search.\n\n' +
      'Branch scoping: admins search every branch, or the one given in ' +
      'branchId; managers only their own (branchId left out or their own), ' +
      'and another branchId is 403 { code: WRONG_BRANCH }.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ data: [{ id, product_id, imei, imei_number, serial_number, status, ' +
      'created_at, product: { name, sku, tracking_method }, branch: { name } ' +
      '}], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({
    status: 400,
    description: 'q missing, under 2 or over 100 characters, or a bad param',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      'A cashier, or { message, code: WRONG_BRANCH } for a manager asking ' +
      'for another branch',
  })
  async search(
    @Query() query: SearchProductUnitsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productUnitsService.search({
      ...query,
      branchId: scopeBranch(user, query.branchId),
    });
  }

  @Get('sellable/by-identifier/:identifier')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Resolve an in-stock IMEI or serial number for POS scanning',
    description:
      'Returns the product and exact identifier only when the matching unit ' +
      'is in stock at the supplied branch. branchId is required; managers ' +
      'and cashiers may only give their own branch (another is 403 ' +
      '{ code: WRONG_BRANCH }, Phase 2 P2-3); admins any branch.',
  })
  @ApiParam({ name: 'identifier', description: 'Exact IMEI or serial number' })
  @ApiResponse({
    status: 403,
    description: '{ message, code: WRONG_BRANCH }: another branch, for staff',
  })
  async findSellableByIdentifier(
    @Param('identifier') identifier: string,
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Required, so scopeBranch gives back this branch (or refuses staff).
    const scoped = scopeBranch(user, branchId) ?? branchId;
    return this.productUnitsService.findSellableByIdentifier(
      identifier,
      scoped,
    );
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
  @ApiResponse({
    status: 404,
    description:
      'Product unit not found; also, for a manager, a unit at another ' +
      'branch (Phase 2 P2-3: the same answer, so its existence is not ' +
      'revealed)',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productUnitsService.findOne(id, {
      branchId: scopeBranch(user),
    });
  }

  @Get(':id/details')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'One unit for its details page (INV-F2)',
    description:
      'Admin/Manager only. The unit, its product and branch, how it was ' +
      'acquired, its completed and voided sales and its returns, newest ' +
      'first. Carries no prices or amounts, no customer contact details and ' +
      'no free text: use this, not GET /product-units/:id, to display a ' +
      'unit. acquisition.type is STOCK_PURCHASE, PHONE_PURCHASE, TRADE_IN or ' +
      'UNKNOWN (no reliable record, as for a unit received before the stock ' +
      'ledger; its other acquisition fields are null).',
  })
  @ApiParam({ name: 'id', description: 'ProductUnit UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      '{ unit, product, branch, acquisition: { type, date, stock_purchase, ' +
      'supplier_name, customer_name, sale }, sales: [{ id, sale_number, ' +
      'status, completed_at, voided_at, customer_name }], returns: [{ id, ' +
      'return_number, sale_id, sale_number, disposition, returned_at }] }',
  })
  @ApiResponse({ status: 400, description: 'Malformed id' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'A cashier' })
  @ApiResponse({
    status: 404,
    description:
      'Product unit not found; also, for a manager, a unit at another ' +
      'branch (the same answer, so its existence is not revealed)',
  })
  async findDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productUnitsService.findDetails(id, {
      branchId: scopeBranch(user),
    });
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
