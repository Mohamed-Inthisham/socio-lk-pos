import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { StockService } from './stock.service';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { scopeBranch } from '../common/utils/branch-scope';

@ApiTags('Stock')
@ApiCookieAuth('access_token')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List stock rows',
    description:
      'Returns stock rows with nested product and branch data plus a ' +
      'computed low_stock_alert flag. All roles can read. Supports ' +
      'filtering by product, branch, or low-stock alerts.\n\n' +
      'Branch scoping (Phase 2 P2-4): admins see every branch, or the one ' +
      'given in branchId; managers and cashiers see only their own branch ' +
      '(branchId left out or their own), and another branchId is ' +
      '403 { code: WRONG_BRANCH }. productId and branchId must be UUIDs.',
  })
  @ApiQuery({
    name: 'productId',
    required: false,
    type: String,
    format: 'uuid',
    description: 'Filter to stock for a specific product',
  })
  @ApiQuery({
    name: 'branchId',
    required: false,
    type: String,
    format: 'uuid',
    description:
      'Filter to stock at a specific branch. Staff: their own branch when ' +
      'left out; another branch is 403 WRONG_BRANCH',
  })
  @ApiQuery({
    name: 'lowStockOnly',
    required: false,
    type: Boolean,
    description:
      'When true, returns only rows where low_stock_alert is true and ' +
      'stock tracking is enabled. Powers the dashboard low-stock widget.',
  })
  @ApiResponse({ status: 200, description: 'List of stock rows' })
  @ApiResponse({
    status: 400,
    description: 'productId or branchId is not a UUID',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: '{ message, code: WRONG_BRANCH }: another branch, for staff',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('productId', new ParseUUIDPipe({ optional: true }))
    productId?: string,
    @Query('branchId', new ParseUUIDPipe({ optional: true }))
    branchId?: string,
    @Query('lowStockOnly', new ParseBoolPipe({ optional: true }))
    lowStockOnly?: boolean,
  ) {
    return this.stockService.findAll({
      productId,
      branchId: scopeBranch(user, branchId),
      lowStockOnly,
    });
  }

  @Get('by-product/:productId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get all stock rows for a product',
    description:
      'Convenience endpoint — returns the stock rows for the given ' +
      'product, one per branch. Branch scoping (Phase 2 P2-4): admins get ' +
      'every branch; managers and cashiers only their own branch (an ' +
      'empty list when it has no row for the product).',
  })
  @ApiParam({
    name: 'productId',
    description: 'Product UUID',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'List of stock rows for the product',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findByProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.findByProduct(productId, scopeBranch(user));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Get a stock row by ID' })
  @ApiParam({ name: 'id', description: 'Stock UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Stock row found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 404,
    description:
      'Stock row not found; also, for staff, a row at another branch ' +
      '(Phase 2 P2-4: the same answer, so its existence is not revealed)',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.findOne(id, { branchId: scopeBranch(user) });
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Stock', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Manually create a stock row',
    description:
      'Admin-only. Stock rows are usually auto-created when a product is ' +
      'created. This endpoint exists for edge cases (multi-branch stock ' +
      'creation, missing rows). Requires product and branch to be active.',
  })
  @ApiResponse({ status: 201, description: 'Stock row created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or product/branch missing or inactive',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({
    status: 409,
    description: 'Stock row for this product+branch already exists',
  })
  async create(
    @Body() dto: CreateStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.create(dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Stock', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Adjust a stock row',
    description:
      'Admin-only. The primary way stock changes in R1 — receiving new ' +
      'units, correcting counts, updating min-quantity thresholds. ' +
      'product_id and branch_id cannot change after creation.',
  })
  @ApiParam({ name: 'id', description: 'Stock UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Stock row updated' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Stock row not found' })
  @ApiResponse({
    status: 409,
    description:
      '{ message, code: STOCK_QUANTITY_CHANGED, stock_id, ' +
      'expected_quantity, current_quantity }: expected_quantity no longer ' +
      'matches the stock. Nothing was written.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.update(id, dto, user);
  }
}
