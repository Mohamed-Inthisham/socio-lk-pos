import {
  Body,
  Controller,
  Get,
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
import { PhonePurchasesService } from './phone-purchases.service';
import { CreatePhonePurchaseDto } from './dto/create-phone-purchase.dto';
import { ListPhonePurchasesQueryDto } from './dto/list-phone-purchases-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Phone Purchases')
@ApiCookieAuth('access_token')
@Controller('phone-purchases')
export class PhonePurchasesController {
  constructor(private readonly phonePurchasesService: PhonePurchasesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List phone purchases (paginated, filterable)',
    description:
      'All authenticated roles can list phone purchases. Filters: ' +
      'customer_id, branchId. Pagination: page (default 1), limit ' +
      '(default 50, max 200). Sorted by created_at DESC. ' +
      'Note: multi-branch scoping ("only my branch") is deferred to ' +
      'R9, matching Sales precedent; for now all roles see all purchases.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of phone purchases with nested customer, branch, ' +
      'cashier, and product_units. Shape: { data: PhonePurchase[], ' +
      'meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(@Query() query: ListPhonePurchasesQueryDto) {
    return this.phonePurchasesService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary:
      'Get a phone purchase by ID (with nested customer, branch, ' +
      'cashier, and product_units)',
    description:
      'Returns the purchase with all its relations eagerly loaded. ' +
      'The product_units relation contains exactly one unit in Slice ' +
      'D (single-unit purchases are all that is supported); the ' +
      'plural relation is future-proof for multi-unit intake.',
  })
  @ApiParam({ name: 'id', description: 'PhonePurchase UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Phone purchase found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Phone purchase not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.phonePurchasesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @Auditable('PhonePurchase', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a phone purchase (intake a used phone from a customer)',
    description:
      'Atomically creates a PhonePurchase row AND its corresponding ' +
      'ProductUnit (status IN_STOCK) AND increments the Stock row for ' +
      '(product_id, branch_id) under pessimistic lock. Any step ' +
      'failing rolls back the entire transaction.\n\n' +
      'cashier_id is taken from the JWT — you cannot attribute an ' +
      'intake to another user. Non-admin cashiers can only intake at ' +
      'their own assigned branch; admins can intake at any branch. ' +
      'Customer resolution (search / create) happens on the frontend ' +
      'before calling this endpoint — pass an existing customer_id.\n\n' +
      'Cross-entity validation:\n' +
      '  - customer_id must exist and not be soft-deleted (400 otherwise)\n' +
      '  - branch_id must exist and be active (400 otherwise)\n' +
      '  - product_id must exist, belong to branch_id, and have ' +
      'is_serialized = true (400 otherwise)\n' +
      '  - imei must not collide with any existing ProductUnit — ' +
      "regardless of that unit's status. Returns 409 with a " +
      'structured existing_unit payload for frontend messaging.\n\n' +
      'Returns the fully-hydrated PhonePurchase with nested customer, ' +
      'branch, cashier, and the newly-created product_unit.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Phone purchase created; response is the fully-hydrated ' +
      'PhonePurchase with all relations',
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed — invalid payload, customer/branch/product ' +
      'reference broken, or product not serialized',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Non-admin cashier attempted to intake at a different branch',
  })
  @ApiResponse({ status: 404, description: 'Cashier not found (edge case)' })
  @ApiResponse({
    status: 409,
    description:
      'IMEI already exists in inventory. Response body includes ' +
      'existing_unit: { id, status, product_id } for frontend messaging.',
  })
  async create(
    @Body() dto: CreatePhonePurchaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.phonePurchasesService.create(dto, user.id);
  }
}
