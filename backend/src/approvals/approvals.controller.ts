import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { SetApprovalPinDto } from './dto/set-approval-pin.dto';
import { ListApproversQueryDto } from './dto/list-approvers-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../users/enums/user-role.enum';

/**
 * Manager approval PIN endpoints (Phase 6.4 P6-16, P6-18), kept together
 * here rather than spread over the auth and users controllers. Not
 * @Auditable: the service writes its own audit rows (the interceptor
 * records only successes and never the request body, and these rows must
 * name the target user).
 */
@ApiTags('Approvals')
@ApiCookieAuth('access_token')
@Controller()
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get('approvers')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Who can approve at a branch (id + name only)',
    description:
      'Active admins, and active managers of the branch, who have an ' +
      'approval PIN set, ordered by name. Returns only id and full_name. ' +
      'Non-admins may ask only for their own branch (403 otherwise).',
  })
  @ApiResponse({ status: 200, description: '[{ id, full_name }]' })
  @ApiResponse({ status: 400, description: 'branchId missing or not a UUID' })
  @ApiResponse({ status: 403, description: "Not the caller's branch" })
  async listApprovers(
    @Query() query: ListApproversQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvalsService.listApprovers(user, query.branchId);
  }

  @Put('auth/me/approval-pin')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Set your own approval PIN',
    description:
      'Admins and managers only. Needs your current password. The PIN is ' +
      'exactly 6 digits; one repeated digit and straight runs (123456, ' +
      '654321) are refused. Resets the wrong-PIN count and any lock. ' +
      'Audited (never the PIN or the password). Nobody can set another ' +
      "user's PIN.",
  })
  @ApiResponse({
    status: 200,
    description: '{ has_approval_pin: true, approval_pin_set_at }',
  })
  @ApiResponse({ status: 400, description: 'PIN malformed or too weak' })
  @ApiResponse({
    status: 403,
    description:
      'Cashier, or current password wrong ({ message, code: WRONG_PASSWORD })',
  })
  async setOwnPin(
    @Body() dto: SetApprovalPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.approvalsService.setOwnPin(user, dto, ip);
  }

  @Delete('users/:id/approval-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Clear a user's approval PIN (admin)",
    description:
      'Clears the PIN, its wrong-PIN count and any lock; the user sets a ' +
      'new one. 204 even when no PIN was set. Audited (actor and target).',
  })
  @ApiParam({ name: 'id', description: 'User UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Cleared' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async clearPin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<void> {
    await this.approvalsService.clearPin(user, id, ip);
  }
}
