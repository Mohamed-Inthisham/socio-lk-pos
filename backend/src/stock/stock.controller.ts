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
      'filtering by product, branch, or low-stock alerts.',
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
    description: 'Filter to stock at a specific branch',
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
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(
    @Query('productId') productId?: string,
    @Query('branchId') branchId?: string,
    @Query('lowStockOnly', new ParseBoolPipe({ optional: true }))
    lowStockOnly?: boolean,
  ) {
    return this.stockService.findAll({ productId, branchId, lowStockOnly });
  }

  @Get('by-product/:productId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get all stock rows for a product',
    description:
      'Convenience endpoint — returns every branch that has stock for ' +
      'the given product. In R1 there is one row per product; in R9 ' +
      'multi-branch, one row per branch.',
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
  async findByProduct(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.stockService.findByProduct(productId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Get a stock row by ID' })
  @ApiParam({ name: 'id', description: 'Stock UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Stock row found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Stock row not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stockService.findOne(id);
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
  async create(@Body() dto: CreateStockDto) {
    return this.stockService.create(dto);
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
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
  ) {
    return this.stockService.update(id, dto);
  }
}
