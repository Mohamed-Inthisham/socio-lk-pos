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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Customers')
@ApiCookieAuth('access_token')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List customers (paginated, searchable)',
    description:
      'All authenticated roles can list customers. Filters: search ' +
      '(substring match across name / phone / nic, case-insensitive), ' +
      'include_deleted ("true" to include soft-deleted rows). ' +
      'Pagination: page (default 1), limit (default 50, max 200). ' +
      'Sorted by created_at DESC, id DESC (stable ordering across pages).',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of customers. Shape: { data: Customer[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(@Query() query: CustomerQueryDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Get a customer by ID',
    description:
      'Returns the customer including soft-deleted rows (so admin ' +
      'restore flows can fetch first). Check deleted_at on the response ' +
      'to distinguish active vs deleted.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Customer found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @Auditable('Customer', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'All roles can create customers (walk-in flow requires this at ' +
      'the register). name and phone are required; nic is optional but ' +
      'unique when present. Phone accepts 0771234567, +94771234567, or ' +
      '94771234567 and is normalized to 0XXXXXXXXX on the way in. If a ' +
      'customer with the given NIC already exists, returns 409 with ' +
      'existing_customer_id in the payload so the client can offer to ' +
      'reuse the existing record.',
  })
  @ApiResponse({ status: 201, description: 'Customer created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (invalid phone, name too long, etc.)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 409,
    description:
      'A customer with this NIC already exists. Response body includes existing_customer_id.',
  })
  async create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @Auditable('Customer', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a customer',
    description:
      "REST PATCH semantics: undefined = don't touch, null = clear " +
      '(nullable fields only), value = set. name and phone are non-nullable ' +
      'so cannot be cleared. nic uniqueness is re-checked when it changes. ' +
      'Deleted customers cannot be updated — restore first via ' +
      'POST /customers/:id/reactivate.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Customer updated' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({
    status: 409,
    description:
      'NIC clash with another customer, or customer is deleted (restore first)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Auditable('Customer', AuditAction.DELETE)
  @ApiOperation({
    summary: 'Soft-delete a customer',
    description:
      'Restricted to ADMIN and MANAGER — cashiers can create customers ' +
      'but not delete them (destructive action requires supervisor ' +
      'authority). Sets deleted_at; the customer remains in the DB and ' +
      'can be restored via POST /customers/:id/reactivate. Historical ' +
      'PhonePurchase and Sale records referencing this customer are ' +
      'unaffected.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Customer soft-deleted' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cashier attempted to delete (admin or manager only)',
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({
    status: 409,
    description: 'Customer is already deleted',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.customersService.remove(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Auditable('Customer', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Restore a soft-deleted customer',
    description:
      'Restricted to ADMIN and MANAGER. Clears deleted_at. Blocks ' +
      "restoration if the customer's NIC has since been assigned to " +
      'another active customer (returns 409 with existing_customer_id). ' +
      'Returns the fully-restored customer.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Customer restored' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Cashier attempted to reactivate (admin or manager only)',
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({
    status: 409,
    description:
      'Customer is not deleted, or NIC now clashes with another active customer',
  })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.reactivate(id);
  }
}
