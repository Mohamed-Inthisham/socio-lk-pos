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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { Auditable } from '../audit-log/decorators/auditable.decorator';
import { AuditAction } from '../audit-log/enums/audit-action.enum';

@ApiTags('Products')
@ApiCookieAuth('access_token')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'List products (paginated, searchable, filterable)',
    description:
      'Returns active products by default, sorted by created_at DESC, id ' +
      'DESC (newest first, stable across pages). Filters, combined with ' +
      'AND: search (case-insensitive substring match on name; trimmed, ' +
      'empty ignored, 2–100 chars), includeInactive, brandId, categoryId, ' +
      'branchId, productType. Pagination: page (default 1), limit ' +
      '(default 50, max 200). Every product includes nested brand, ' +
      'category, and branch objects for one-shot rendering.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of products. Shape: { data: Product[], meta: { total, page, limit, totalPages, hasNext, hasPrev } }',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid query parameter (e.g. search shorter than 2 characters)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async findAll(@Query() query: ListProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get('by-barcode/:barcode')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Look up a product by exact barcode string',
    description:
      'Used by the POS terminal when the cashier scans a barcode. ' +
      'Returns 404 if no product has that barcode.',
  })
  @ApiParam({
    name: 'barcode',
    description: 'Exact barcode string (e.g. SLP-000001 or 194252056387)',
  })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'No product with that barcode' })
  async findByBarcode(@Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(barcode);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Get a product by ID (with nested relations)' })
  @ApiParam({ name: 'id', description: 'Product UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @Auditable('Product', AuditAction.CREATE)
  @ApiOperation({
    summary: 'Create a new product',
    description:
      'Admin-only. SKU is always auto-generated (SKU-XXXXXX). Barcode ' +
      'is auto-generated (SLP-XXXXXX) if omitted, or accepted if provided. ' +
      'Referenced brand, category, and branch must all be active.',
  })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or brand/category/branch is missing or inactive',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 409, description: 'Provided barcode already in use' })
  async create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Product', AuditAction.UPDATE)
  @ApiOperation({
    summary: 'Update a product',
    description:
      'Admin-only. Any subset of fields can be updated. SKU can be ' +
      'manually changed here (unlike create, where it is always auto-generated). ' +
      'Barcode and SKU must remain unique.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or referenced entity inactive',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'SKU or barcode already in use' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @Auditable('Product', AuditAction.DEACTIVATE)
  @ApiOperation({
    summary: 'Deactivate a product',
    description:
      'Admin-only. Sets is_active=false. Product still appears in ' +
      'historical sales; only new sales stop suggesting it. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product deactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @Auditable('Product', AuditAction.REACTIVATE)
  @ApiOperation({
    summary: 'Reactivate a deactivated product',
    description: 'Admin-only. Sets is_active=true. Idempotent.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product reactivated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.reactivate(id);
  }
}
