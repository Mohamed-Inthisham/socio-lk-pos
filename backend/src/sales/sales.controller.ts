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
  Ip,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { SaleBranchGuard } from './guards/sale-branch.guard';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { SalesDailySummaryQueryDto } from './dto/sales-daily-summary-query.dto';
import { AddSaleLineDto } from './dto/add-sale-line.dto';
import { UpdateSaleLineDto } from './dto/update-sale-line.dto';
import { AddPaymentDto } from './dto/add-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
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
      'All authenticated roles can list sales. Filters: branchId, cashierId, customerId, ' +
      'status (DRAFT/COMPLETED/VOIDED), from, to (created_at), ' +
      'completedFrom, completedTo (completed_at; timestamps with an offset, ' +
      'date-only is a 400; excludes drafts), and q (sale number, customer ' +
      'name or phone by substring, or an exact IMEI on a line or a trade-in). ' +
      'Pagination: page (default 1), limit (default 50, max 200). Sorted by ' +
      'created_at DESC, or completed_at DESC with sort=completed_at. ' +
      'Note: multi-branch scoping ("only my branch") is deferred to R9; for now ' +
      'all roles see all sales.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of sales with nested branch + cashier + customer ' +
      '(soft-deleted ones included; customer null for a walk-in). ' +
      'Shape: { data: Sale[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(@Query() query: ListSalesQueryDto) {
    return this.salesService.findAll(query);
  }

  @Get('daily-summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Daily completed sales overview totals' })
  async dailySummary(@Query() query: SalesDailySummaryQueryDto) {
    return this.salesService.dailySummary(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary:
      'Get a sale by ID (with nested branch, cashier, customer, voider, lines, payments)',
    description:
      'Returns the sale with branch, cashier, customer (null when none is ' +
      'attached), voider (who voided it; null unless VOIDED), lines ordered ' +
      'by line_number, and payments ordered by ' +
      'created_at. A soft-deleted customer, cashier or voider is still included, ' +
      'with deleted_at set, so historical sales keep naming them. Every ' +
      'endpoint that returns the hydrated sale uses this same shape.',
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
  @UseGuards(SaleBranchGuard)
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
  @UseGuards(SaleBranchGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Discard a DRAFT sale',
    description:
      'Hard-deletes a DRAFT sale. Only DRAFT sales can be discarded — a ' +
      'DRAFT never became a real financial record, so no history is lost. ' +
      'Completed sales must be VOIDED via POST /sales/:id/void, never deleted.',
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
  @UseGuards(SaleBranchGuard)
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
  @UseGuards(SaleBranchGuard)
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
  @UseGuards(SaleBranchGuard)
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
  @UseGuards(SaleBranchGuard)
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
      'amount_paid and change_due.\n\n' +
      'TRADE_IN: the customer pays (part of) the sale with a used phone. ' +
      'Requires a customer on the sale, plus trade_in_product_id (a ' +
      "serialized product at the sale's branch), trade_in_imei, and " +
      'trade_in_buying_price, which must equal amount. trade_in_selling_price ' +
      'and trade_in_notes are optional. cash_received and reference_number ' +
      'must be omitted. Nothing is added to inventory yet — the ' +
      'PhonePurchase, ProductUnit, and stock increment are created when the ' +
      'sale completes. trade_in_* fields are rejected on every other method.',
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
      'non-CASH reference_number missing, or a TRADE_IN rule failed ' +
      '(missing required trade-in field, amount != trade_in_buying_price, ' +
      'no customer on the sale, bad trade-in product, trade_in_* on a ' +
      'non-TRADE_IN payment)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  @ApiResponse({
    status: 409,
    description:
      'TRADE_IN only: trade_in_imei already exists in inventory. Response ' +
      'body includes existing_unit { id, status, product_id }.',
  })
  async addPayment(
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body() dto: AddPaymentDto,
  ) {
    await this.salesService.addPayment(saleId, dto);
    return this.salesService.findOne(saleId);
  }

  @Patch(':saleId/payments/:paymentId')
  @UseGuards(SaleBranchGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Update a payment on a DRAFT sale',
    description:
      'Partial update. Updatable fields: amount, cash_received, ' +
      'reference_number, notes. payment_method is FROZEN — to change ' +
      'method (e.g. CASH to CARD), remove and re-add the payment for a ' +
      'clean audit trail. Cross-field rules revalidated against the ' +
      'merged state. Returns the updated sale.\n\n' +
      'TRADE_IN payments are frozen except for notes — amount, ' +
      'cash_received, and reference_number are rejected with 400. To ' +
      'renegotiate a trade-in value, remove the payment and add a new one. ' +
      'trade_in_* fields are not patchable on any payment.',
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
      'attempted to clear reference_number on a non-CASH payment, or ' +
      'attempted to change a frozen field on a TRADE_IN payment',
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
  @UseGuards(SaleBranchGuard)
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
  @UseGuards(SaleBranchGuard)
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @Auditable('Sale', AuditAction.COMPLETE)
  @ApiOperation({
    summary: 'Complete a DRAFT sale (transactional: stock + numbering)',
    description:
      'Transitions a DRAFT sale into COMPLETED in a single atomic ' +
      'transaction. Decrements stock for every in-house line ' +
      '(external-supplier lines belong to friendly shops and are ' +
      'settled separately in Phase 6.7). Flips serialized in-house units ' +
      'to SOLD. For each TRADE_IN payment, creates the PhonePurchase and ' +
      'an IN_STOCK ProductUnit, increments stock for the trade-in product, ' +
      'and stamps trade_in_phone_purchase_id on the payment. Issues the ' +
      'invoice number via the branch/date counter. Sets status=COMPLETED ' +
      'and completed_at=now(). If any step fails — insufficient stock, ' +
      'IMEI conflict, underpayment, missing lines — the whole transaction ' +
      'rolls back and nothing changes.\n\n' +
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
      'Sale is not in DRAFT status, has no lines, amount_paid does ' +
      'not equal total, or the sale has TRADE_IN payments but no customer',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 404,
    description: 'Sale not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Insufficient stock for one or more lines (body includes the product ' +
      'name and available quantity); a serialized unit on a line is no ' +
      'longer IN_STOCK; or a trade-in IMEI already exists in inventory. ' +
      'The IMEI cases include an existing_unit payload.',
  })
  async completeSale(@Param('id', ParseUUIDPipe) id: string) {
    await this.salesService.completeSale(id);
    return this.salesService.findOne(id);
  }

  // Every role may call it: the approver's PIN is the authority (P6-17).
  // Not @Auditable: voidSale writes the VOID audit row in its own
  // transaction, naming both the approver and the session user.
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary:
      'Void a COMPLETED sale (transactional: stock reversal + payment reversal)',
    description:
      'Transitions a COMPLETED sale into VOIDED in a single atomic ' +
      'transaction. Re-increments stock for every in-house line ' +
      '(external-supplier lines were never our inventory, so nothing to ' +
      'reverse) and flips serialized in-house units back to IN_STOCK. For ' +
      'each TRADE_IN payment, flips the traded-in unit to RETURNED and ' +
      'decrements its stock; the PhonePurchase stays as history. Stamps ' +
      'reversed_at and reversal_reason on every payment ' +
      'on this sale. Sets status=VOIDED, voided_at=now(), ' +
      'voided_by=<approver>, void_requested_by=<session user>, and ' +
      'void_reason=<trimmed reason>. If any step fails, the whole ' +
      'transaction rolls back and nothing changes.\n\n' +
      'Every void needs a manager approval PIN (Phase 6.4 P6-17), on every ' +
      "session, a manager's or admin's own included: approval = " +
      "{ approver_id, pin }. Any role at the sale's branch may ask (admins " +
      'at any branch); the approver is an active admin, or a manager of the ' +
      "sale's branch, with a PIN, and may be the session user. The PIN is " +
      'checked in its own committed transaction first, so a wrong PIN is ' +
      'counted even though nothing is voided; 5 wrong in a row lock that ' +
      'PIN for 15 minutes. The VOID audit row names both people.\n\n' +
      'VOIDED is TERMINAL. There is no un-void endpoint — if a void was ' +
      'itself a mistake, create a new sale. The original sale_number, ' +
      'completed_at, lines, and payment amounts are all preserved on the ' +
      'voided record for audit purposes.\n\n' +
      'Preconditions: sale is COMPLETED (DRAFT sales are discarded via ' +
      'DELETE, VOIDED sales are terminal). void_reason is required and ' +
      'must be at least 3 non-whitespace characters.\n\n' +
      'Returns the fully-hydrated voided sale with nested branch, cashier, ' +
      'lines, and payments (with their reversal stamps).',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      'Sale voided; response is the fully-hydrated sale with VOIDED status, ' +
      'voided_at/voided_by/void_reason set, and every payment stamped with ' +
      'reversed_at and reversal_reason',
  })
  @ApiResponse({
    status: 400,
    description:
      'Sale is not in COMPLETED status (DRAFT or VOIDED), void_reason ' +
      'is missing/blank/too short, or approval is missing or malformed',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      '{ message, code }: VOID_WRONG_BRANCH (the session user is at another ' +
      'branch), WRONG_PIN (with attempts_left), or the approver is refused: ' +
      'APPROVER_NOT_FOUND, APPROVER_INACTIVE, APPROVER_NOT_MANAGER, ' +
      'APPROVER_WRONG_BRANCH, APPROVER_NO_PIN. Never the PIN.',
  })
  @ApiResponse({
    status: 423,
    description:
      "{ message, code: PIN_LOCKED, locked_until }: the approver's PIN is " +
      'locked (also on the 5th wrong PIN in a row).',
  })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  @ApiResponse({
    status: 409,
    description:
      'A later transaction blocks the void. Body: message, imei, reason, ' +
      'later_sale ({ id, sale_number } or null), existing_unit. reason: ' +
      'RESOLD (a trade-in phone from this sale was sold on later_sale: void ' +
      'it first); TAKEN_BACK_ON_SALE (a phone this sale sold was traded back ' +
      'in on later_sale: void it first); BOUGHT_BACK_ON_PURCHASE (a phone ' +
      'this sale sold was bought back on a later phone purchase: the sale ' +
      "can't be voided, later_sale null); null when only the live-IMEI " +
      'index caught a concurrent take-back (later_sale and existing_unit null).',
  })
  async voidSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSaleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    await this.salesService.voidWithApproval(id, user, dto, ip);
    return this.salesService.findOne(id);
  }
}
