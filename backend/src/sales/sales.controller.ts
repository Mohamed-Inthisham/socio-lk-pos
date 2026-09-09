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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { AddSaleLineDto } from './dto/add-sale-line.dto';
import { UpdateSaleLineDto } from './dto/update-sale-line.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Sales')
@ApiCookieAuth('access_token')
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List sales (paginated, filterable)',
    description:
      'All authenticated roles can list sales. Filters: branchId, cashierId, ' +
      'status (DRAFT/COMPLETED/VOIDED), from, to. Pagination: page (default 1), ' +
      'limit (default 50, max 200). Sorted by created_at DESC. ' +
      'Note: multi-branch scoping ("only my branch") is deferred to R9; for now ' +
      'all roles see all sales.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of sales with nested branch + cashier. ' +
      'Shape: { data: Sale[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(@Query() query: ListSalesQueryDto) {
    return this.salesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get a sale by ID (with nested branch + cashier)',
    description:
      'Returns the sale with its branch and cashier eagerly loaded. ' +
      'Lines and payments will be included from Slices D and E onward.',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sale found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Create a new DRAFT sale',
    description:
      'Starts an empty cart. cashier_id is taken from the JWT — you cannot ' +
      'attribute a sale to another user. Non-admin users can only create sales ' +
      'at their own assigned branch; admins can create at any branch. ' +
      'Sale starts as DRAFT with zeroed totals; lines and payments are added ' +
      'via sub-resource endpoints in later slices.',
  })
  @ApiResponse({ status: 201, description: 'DRAFT sale created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, or branch is inactive',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      'Non-admin cashier attempted to create a sale at a different branch, ' +
      'or cashier account is inactive',
  })
  @ApiResponse({
    status: 404,
    description: 'Branch or cashier not found',
  })
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.salesService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Update a DRAFT sale (sale-level fields only)',
    description:
      'Partially updates notes and/or customer_id. Only DRAFT sales are ' +
      'mutable — attempting to update a COMPLETED or VOIDED sale returns 400 ' +
      '(completed sales are immutable historical records). ' +
      'Lines and payments have their own sub-resource endpoints.',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sale updated' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed, or sale is not in DRAFT status',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSaleDto,
  ) {
    return this.salesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Discard a DRAFT sale',
    description:
      'Hard-deletes a DRAFT sale. Only DRAFT sales can be discarded — a ' +
      'DRAFT never became a real financial record, so no history is lost. ' +
      'Completed sales must be VOIDED, never deleted (endpoint lands in Slice G).',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'DRAFT sale discarded' })
  @ApiResponse({
    status: 400,
    description: 'Sale is not in DRAFT status (cannot be discarded)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  async discardDraft(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.salesService.discardDraft(id);
  }

  // ---- Line sub-resource endpoints ----
  //
  // Each mutation returns the whole updated sale (with nested lines and
  // refreshed totals) so the POS frontend never needs a follow-up GET
  // after ringing up an item. DELETE returns 204 as usual.

  @Post(':saleId/lines')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Add a line to a DRAFT sale',
    description:
      'Adds a product line to the cart. Snapshot fields (sku, name, ' +
      'unit_price, cost_price) are frozen from the product at add-time. ' +
      'Product must be active and belong to the same branch as the sale. ' +
      'Discount is optional; if set, both discount_type and discount_value ' +
      'must be provided. Returns the updated sale with all lines and ' +
      'recomputed totals.',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Line added; response is the updated sale with nested lines',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, sale not DRAFT, product/supplier inactive, ' +
      'product from different branch, or discount exceeds line subtotal',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 404,
    description: 'Sale, product, or supplier not found',
  })
  async addLine(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body() dto: AddSaleLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.salesService.addLine(saleId, dto, user.id);
    return this.salesService.findOne(saleId);
  }

  @Patch(':saleId/lines/:lineId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Update a line on a DRAFT sale',
    description:
      'Partial update. Updatable fields: quantity, discount (both type+value ' +
      'together, or both null to clear), external_supplier_id, imei_snapshot. ' +
      'Snapshot fields (sku, name, unit_price, cost_price) and line_number ' +
      'are frozen — to change the product or price, remove and re-add the line. ' +
      'Returns the updated sale with recomputed totals.',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiParam({ name: 'lineId', description: 'SaleLine UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Line updated; response is the updated sale',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, sale not DRAFT, discount consistency broken, ' +
      'or discount exceeds line subtotal',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 404,
    description: 'Sale, line, or supplier not found',
  })
  async updateLine(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdateSaleLineDto,
  ) {
    await this.salesService.updateLine(saleId, lineId, dto);
    return this.salesService.findOne(saleId);
  }

  @Delete(':saleId/lines/:lineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Remove a line from a DRAFT sale',
    description:
      'Hard-deletes the line and recomputes sale totals. Only DRAFT sales ' +
      'can have lines removed. line_number is not renumbered — gaps in the ' +
      'sequence are intended (removes never shift other line numbers).',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiParam({ name: 'lineId', description: 'SaleLine UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Line removed' })
  @ApiResponse({
    status: 400,
    description: 'Sale is not in DRAFT status',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale or line not found' })
  async removeLine(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<void> {
    await this.salesService.removeLine(saleId, lineId);
  }
}
