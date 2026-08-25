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
}
