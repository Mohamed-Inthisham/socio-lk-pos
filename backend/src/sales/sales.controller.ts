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
import { AddPaymentDto } from './dto/add-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

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
  // ---- Payment sub-resource endpoints ----
  //
  // Each mutation returns the whole updated sale (with nested lines,
  // payments, and refreshed totals) so the POS frontend never needs a
  // follow-up GET after recording a payment. DELETE returns 204.

  @Post(':saleId/payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Record a payment on a DRAFT sale',
    description:
      'Adds a tender to the sale. Multi-tender supported: a sale can ' +
      'have multiple payments summing to the total. CASH requires ' +
      'cash_received >= amount (change computed on receipt). CARD, ' +
      'BANK_TRANSFER, KOKO, and MINTPAY all require reference_number ' +
      'for reconciliation. amount cannot exceed the remaining balance. ' +
      'Returns the updated sale with all lines, payments, and recomputed ' +
      'amount_paid and change_due.',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Payment recorded; response is the updated sale',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, sale not DRAFT, amount exceeds remaining balance, ' +
      'CASH cash_received missing or < amount, non-CASH cash_received set, ' +
      'or non-CASH reference_number missing',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  async addPayment(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body() dto: AddPaymentDto,
  ) {
    await this.salesService.addPayment(saleId, dto);
    return this.salesService.findOne(saleId);
  }

  @Patch(':saleId/payments/:paymentId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Update a payment on a DRAFT sale',
    description:
      'Partial update. Updatable fields: amount, cash_received, ' +
      'reference_number, notes. payment_method is FROZEN — to change ' +
      'method (e.g. CASH to CARD), remove and re-add the payment for a ' +
      'clean audit trail. Cross-field rules revalidated against the ' +
      'merged state. Returns the updated sale.',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiParam({ name: 'paymentId', description: 'Payment UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Payment updated; response is the updated sale',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, sale not DRAFT, merged amount exceeds remaining ' +
      'balance (excluding this payment), CASH cash_received < amount, or ' +
      'attempted to clear reference_number on a non-CASH payment',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale or payment not found' })
  async updatePayment(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    await this.salesService.updatePayment(saleId, paymentId, dto);
    return this.salesService.findOne(saleId);
  }

  @Delete(':saleId/payments/:paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Remove a payment from a DRAFT sale',
    description:
      'Hard-deletes the payment and recomputes sale amount_paid and ' +
      'change_due. Only DRAFT sales can have payments removed. Once the ' +
      'sale is COMPLETED, payment reversal happens via sale-level VOID ' +
      '(Slice G).',
  })
  @ApiParam({ name: 'saleId', description: 'Sale UUID', format: 'uuid' })
  @ApiParam({ name: 'paymentId', description: 'Payment UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Payment removed' })
  @ApiResponse({
    status: 400,
    description: 'Sale is not in DRAFT status',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale or payment not found' })
  async removePayment(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<void> {
    await this.salesService.removePayment(saleId, paymentId);
  }
  // ---- Lifecycle endpoints ----
  //
  // The moment a DRAFT sale becomes a real financial record. Stock
  // moves, sale_number is issued, status flips to COMPLETED. First
  // auditable event in the sales domain — DRAFT cart-building activity
  // is noise, but this is a legal record and worth capturing.

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @Auditable('Sale', AuditAction.COMPLETE)
  @ApiOperation({
    summary: 'Complete a DRAFT sale (transactional: stock + numbering)',
    description:
      'Transitions a DRAFT sale into COMPLETED in a single atomic ' +
      'transaction. Decrements stock for every in-house line ' +
      '(external-supplier lines belong to friendly shops and are ' +
      'settled separately in Phase 6.7). Issues the invoice number ' +
      'via the branch/date counter. Sets status=COMPLETED and ' +
      'completed_at=now(). If any step fails — insufficient stock, ' +
      'underpayment, missing lines — the whole transaction rolls back ' +
      'and nothing changes.\n\n' +
      'Preconditions: sale is DRAFT, has at least one line, and ' +
      'amount_paid equals total exactly. Overpayment is already ' +
      'blocked by the payment endpoint; this endpoint blocks ' +
      'underpayment.\n\n' +
      'Returns the fully-hydrated completed sale with nested branch, ' +
      'cashier, lines, and payments.',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      'Sale completed; response is the fully-hydrated sale with the ' +
      'newly-issued sale_number, completed_at timestamp, and COMPLETED status',
  })
  @ApiResponse({
    status: 400,
    description:
      'Sale is not in DRAFT status, has no lines, or amount_paid does ' +
      'not equal total',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 404,
    description: 'Sale not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Insufficient stock for one or more lines. Response body includes ' +
      'the product name and current available quantity.',
  })
  async completeSale(@Param('id', ParseUUIDPipe) id: string) {
    await this.salesService.completeSale(id);
    return this.salesService.findOne(id);
  }
}
