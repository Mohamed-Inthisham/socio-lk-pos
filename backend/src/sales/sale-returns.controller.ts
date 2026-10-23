import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SaleReturnsService } from './sale-returns.service';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto';
import { ListInspectionQueryDto } from './dto/list-inspection-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * Returns and refunds (Phase 6.4 P7). Not @Auditable: the return writes
 * its RETURN audit row inside its own transaction, naming the approver
 * and the session user (as void does).
 */
@ApiTags('Sales')
@ApiCookieAuth('access_token')
@Controller()
export class SaleReturnsController {
  constructor(private readonly saleReturnsService: SaleReturnsService) {}

  // Every role may start a return: the approver's PIN is the authority (P7-9).
  @Post('sales/:id/returns')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Return items on a COMPLETED sale, with refunds',
    description:
      'Takes back any quantity of any line, up to what is left to return ' +
      '(P7-2), and records the money handed back: CASH, or back to a ' +
      'non-cash payment of this sale with the reversal reference (P7-4). ' +
      'The refunds may total anything from 0 to refund_due, what the ' +
      'customer paid for those units (P7-3). Non-phone items from our stock ' +
      'go back to stock (condition RESALEABLE) or are recorded DAMAGED; a ' +
      'phone goes to INSPECTION; another shop’s lines and untracked ' +
      'products never move stock (P7-8). A line outside warranty needs ' +
      'override_reason (P7-22, P7-23).\n\n' +
      "Every return needs a manager's or admin's approval PIN, on every " +
      "session (P7-9). Any role at the sale's branch may ask (admins: any " +
      'branch). Every check that needs no lock runs before the PIN, so a ' +
      'return that can’t go through never spends a PIN attempt; the ' +
      'transaction repeats the race-sensitive ones under its locks.\n\n' +
      'client_request_id (P7-15, P7-24): a resend from the same sale and ' +
      'session user gets the recorded return back with 200, without a PIN ' +
      'check; its body is ignored. From another sale or user: 409 ' +
      'CLIENT_REQUEST_ID_CONFLICT.',
  })
  @ApiParam({ name: 'id', description: 'Sale UUID', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description:
      '{ return_id, sale }: the return was made; sale is the hydrated sale ' +
      'as GET /sales/:id, with lines[].returned_quantity and returns[].',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ return_id, sale }: an accepted resend of a recorded return.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation; or { message, code }: SALE_NOT_COMPLETED, ' +
      'LINE_NOT_ON_SALE (sale_line_id), RETURN_CONDITION_INVALID ' +
      '(sale_line_id), OVERRIDE_REASON_REQUIRED (sale_line_ids), ' +
      'REFUND_TOO_HIGH (refund_due), REFUND_METHOD_NOT_ALLOWED (method, ' +
      'original_payment_id).',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      '{ message, code }: RETURN_WRONG_BRANCH, WRONG_PIN (attempts_left), ' +
      'APPROVER_NOT_FOUND, APPROVER_INACTIVE, APPROVER_NOT_MANAGER, ' +
      'APPROVER_WRONG_BRANCH, APPROVER_NO_PIN. Never the PIN.',
  })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  @ApiResponse({
    status: 409,
    description:
      '{ message, code }: CLIENT_REQUEST_ID_CONFLICT, RETURN_QTY_EXCEEDED ' +
      '(sale_line_id, returnable), PHONE_TAKEN_BACK (imei, reason, ' +
      'later_sale), REFUND_EXCEEDS_PAYMENT (payment_id, refundable).',
  })
  @ApiResponse({
    status: 423,
    description:
      "{ message, code: PIN_LOCKED, locked_until }: the approver's PIN is locked.",
  })
  async createReturn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSaleReturnDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.saleReturnsService.createReturn(
      id,
      dto,
      user,
      ip,
    );
    if (!result.created) res.status(HttpStatus.OK);
    return { return_id: result.return_id, sale: result.sale };
  }

  @Get('sale-returns/inspection')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Returned phones waiting for inspection at a branch',
    description:
      'The branch’s INSPECTION phones, each with the latest return that ' +
      'brought it back, oldest first (P7-7, P7-33). Unpaginated. Admins: any ' +
      'branch; managers: their own (403 INSPECTION_WRONG_BRANCH otherwise).',
  })
  @ApiResponse({
    status: 200,
    description:
      '[{ product_unit: { id, imei, product_name }, return_id, ' +
      'return_number, sale_id, sale_number, returned_at }]',
  })
  @ApiResponse({ status: 400, description: 'branchId missing or not a UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'A cashier, or a manager asking for another branch',
  })
  async listInspection(
    @Query() query: ListInspectionQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.saleReturnsService.listInspection(user, query.branchId);
  }
}
