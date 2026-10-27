import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { CreateStockPurchasePaymentDto } from './dto/create-stock-purchase-payment.dto';
import { UpdateStockPurchasePaymentStatusDto } from './dto/update-stock-purchase-payment-status.dto';
import { StockPurchasesService } from './stock-purchases.service';

@ApiTags('Stock Purchases')
@ApiCookieAuth('access_token')
@Controller('stock-purchases')
export class StockPurchasesController {
  constructor(private readonly service: StockPurchasesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'List stock purchases',
    description:
      'Lists completed stock receipts. Admins can view all branches; managers see their assigned branch.',
  })
  @ApiResponse({ status: 200, description: 'Stock purchases with supplier, branch, creator, and item details.' })
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user);
  }

  @Get('supplier-balances')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get purchase, paid, pending-cheque, and outstanding totals by supplier' })
  @ApiResponse({ status: 200, description: 'Supplier balances across all branches for admins, assigned branch for managers.' })
  async supplierBalances(@CurrentUser() user: AuthenticatedUser) {
    return this.service.supplierBalances(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get a stock purchase with all received items and identifiers' })
  @ApiParam({ name: 'id', description: 'Stock purchase UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Stock purchase details.' })
  @ApiResponse({ status: 404, description: 'Stock purchase not found.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Auditable('StockPurchase', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Record a stock purchase and receive it into a branch',
    description:
      'Atomically records supplier cost, updates branch stock, creates IMEI units for serialized products, and optionally records an initial supplier payment. Cheques remain pending until cleared.',
  })
  @ApiResponse({ status: 201, description: 'Stock purchase recorded and stock received.' })
  @ApiResponse({ status: 400, description: 'Invalid or inactive supplier, branch, product, quantity, or identifier count.' })
  @ApiResponse({ status: 403, description: 'Manager attempted to receive stock at another branch.' })
  @ApiResponse({ status: 409, description: 'IMEI is already assigned to a live product unit.' })
  async create(
    @Body() dto: CreateStockPurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Post(':id/payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Auditable('StockPurchasePayment', AuditAction.CREATE)
  @ApiOperation({ summary: 'Record a payment against a stock purchase' })
  @ApiResponse({ status: 201, description: 'Payment recorded; cheques remain pending until resolved.' })
  async addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStockPurchasePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addPayment(id, dto, user);
  }

  @Patch(':id/payments/:paymentId/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Auditable('StockPurchasePayment', AuditAction.UPDATE)
  @ApiOperation({ summary: 'Mark a pending cheque cleared or bounced' })
  @ApiResponse({ status: 200, description: 'Cheque status updated.' })
  async resolveCheque(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdateStockPurchasePaymentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resolveCheque(id, paymentId, dto, user);
  }
}
