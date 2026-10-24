import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { CashDaysService } from './cash-days.service';
import { OpenCashDayDto } from './dto/open-cash-day.dto';
import { CloseCashDayDto } from './dto/close-cash-day.dto';
import { CurrentCashDayQueryDto } from './dto/current-cash-day-query.dto';
import { ListCashDaysQueryDto } from './dto/list-cash-days-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const DAY_SHAPE =
  '{ id, branch_id, business_date, opening_balance, opened_by: { id, ' +
  'full_name }, opened_at, cash_sales, cash_refunds, cash_voids_earlier, ' +
  'expected_balance, counted_balance, difference, difference_reason, ' +
  'summary, closed_by: { id, full_name } | null, closed_at, created_at, ' +
  'updated_at }. The closing fields are null while the day is open. ' +
  'Money is a 2-decimal string.';

const WRONG_BRANCH =
  '{ message, code: CASH_DAY_WRONG_BRANCH }: managers and cashiers only at ' +
  'their own branch.';

/**
 * The daily opening and closing balance (Phase 6.4 P9). Every role, at
 * its own branch (admins: any, P9-17). Not @Auditable: open and close
 * write their DAY_OPEN / DAY_CLOSE rows inside their own transactions.
 */
@ApiTags('Cash days')
@ApiCookieAuth('access_token')
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
@Controller('cash-days')
export class CashDaysController {
  constructor(private readonly cashDaysService: CashDaysService) {}

  @Get('current')
  @ApiOperation({
    summary: "Today's cash day at a branch, for the day gate",
    description:
      'business_date is today in Colombo by the database clock. today is ' +
      "today's record or null; earlier_open the oldest earlier day still " +
      'open, or null; last_closed the most recent closed day, or null ' +
      '(P9-7, P9-8).',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ business_date, today, earlier_open: { id, business_date } | null, ' +
      'last_closed: { business_date, counted_balance } | null }. today is ' +
      "today's full cash day record, the same shape as GET /cash-days/:id, " +
      `or null: ${DAY_SHAPE}`,
  })
  @ApiResponse({ status: 400, description: 'branchId missing or not a UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async current(
    @Query() query: CurrentCashDayQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashDaysService.current(user, query.branchId);
  }

  @Post('open')
  @ApiOperation({
    summary: "Open today's cash day with the opening balance",
    description:
      'Today is the Colombo date by the database clock. Refused while ' +
      'today already has a record (open or closed: a closed day is never ' +
      'reopened) or an earlier day is still open (P9-7).\n\n' +
      'client_request_id (P9-18): a resend from the same user for the ' +
      'same branch gets the recorded day back with 200; its body is ' +
      'ignored. From anyone else: 409 CLIENT_REQUEST_ID_CONFLICT.',
  })
  @ApiResponse({ status: 201, description: `The day was opened: ${DAY_SHAPE}` })
  @ApiResponse({
    status: 200,
    description: 'An accepted resend: the recorded day, same shape.',
  })
  @ApiResponse({ status: 400, description: 'Validation' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  @ApiResponse({
    status: 409,
    description:
      '{ message, code }: CLIENT_REQUEST_ID_CONFLICT; DAY_ALREADY_OPEN ' +
      '(cash_day_id, closed_at: null while open, set when today was ' +
      'already closed); EARLIER_DAY_NOT_CLOSED (business_date, cash_day_id).',
  })
  async open(
    @Body() dto: OpenCashDayDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.cashDaysService.open(dto, user, ip);
    if (!result.created) res.status(HttpStatus.OK);
    return result.day;
  }

  @Get()
  @ApiOperation({
    summary: "A branch's cash days, newest first",
    description:
      'Paginated; open days included (closed_at null, closed_by null). ' +
      'For the Past days list (P9-16).',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ data, meta }: data is a page of cash day records, each the same ' +
      `shape as GET /cash-days/:id: ${DAY_SHAPE}`,
  })
  @ApiResponse({ status: 400, description: 'Validation' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async list(
    @Query() query: ListCashDaysQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashDaysService.list(user, query);
  }

  @Get(':id/summary')
  @ApiOperation({
    summary: "A cash day's figures",
    description:
      'For an open day, worked out now (the close dialog). For a closed ' +
      'day, the snapshot stored at close, never recomputed. Every amount ' +
      'is dated by when it happened (P9-5, P9-6): cash_sales are the CASH ' +
      'payments of sales completed that day and not voided that day; ' +
      'cash_refunds the CASH refunds of returns made that day; ' +
      'cash_voids_earlier the CASH payments of earlier days’ sales voided ' +
      'that day. expected = opening + cash_sales − cash_refunds − ' +
      'cash_voids_earlier, and may be negative.',
  })
  @ApiParam({ name: 'id', description: 'Cash day UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      '{ cash_day_id, business_date, closed, opening_balance, cash_sales, ' +
      'cash_refunds, cash_voids_earlier, expected_balance, summary: { ' +
      'non_cash_sales, non_cash_refunds, earlier_voids_non_cash (each { ' +
      'CARD, BANK_TRANSFER, KOKO, MINTPAY }), trade_in_value, counts: { ' +
      'sales_completed, returns, voids } } }',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Cash day not found' })
  async summary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashDaysService.summary(user, id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a cash day with the counted cash',
    description:
      "Today's or an earlier day still open. Takes FOR UPDATE on the " +
      'day and works the figures out under it (P9-10). expected_seen must ' +
      'equal the expected worked out then, or 409 EXPECTED_CHANGED with ' +
      'the fresh summary. A difference of 1.00 or more either way needs ' +
      'difference_reason (3+ characters); under 1.00 (0 included, the ' +
      'rounding rule) any reason sent is ignored and stored null, and the ' +
      'difference is still stored exactly. A closed day is never edited or ' +
      'reopened (P9-11).' +
      '\n\nclient_request_id (P9-18): a resend from the same user for the ' +
      'same day gets the closed day back with 200; its body is ignored. ' +
      'From anyone else: 409 CLIENT_REQUEST_ID_CONFLICT.',
  })
  @ApiParam({ name: 'id', description: 'Cash day UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: `The closed day (also on an accepted resend): ${DAY_SHAPE}`,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation; or { message, code: REASON_REQUIRED, difference }.',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Cash day not found' })
  @ApiResponse({
    status: 409,
    description:
      '{ message, code }: CLIENT_REQUEST_ID_CONFLICT; DAY_ALREADY_CLOSED ' +
      '(cash_day_id, closed_at); EXPECTED_CHANGED (summary: the fresh ' +
      'figures, as GET /cash-days/:id/summary).',
  })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashDayDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.cashDaysService.close(id, dto, user, ip);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One cash day, with who opened and closed it',
    description: 'For the reprint (P9-16).',
  })
  @ApiParam({ name: 'id', description: 'Cash day UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: DAY_SHAPE })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: WRONG_BRANCH })
  @ApiResponse({ status: 404, description: 'Cash day not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cashDaysService.findOne(user, id);
  }
}
