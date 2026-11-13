import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BarcodeLabelsService } from './barcode-labels.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../users/enums/user-role.enum';
import { scopeBranch } from '../common/utils/branch-scope';
import {
  ProductLabelSearchResponseDto,
  ResolvedLabelQueueResponseDto,
  UnitLabelSearchResponseDto,
} from './dto/label-responses.dto';
import { SearchProductLabelsQueryDto } from './dto/search-product-labels-query.dto';
import { SearchUnitLabelsQueryDto } from './dto/search-unit-labels-query.dto';
import { ResolveLabelQueueDto } from './dto/resolve-label-queue.dto';

/**
 * Barcode Labels: admins and managers only, set once on the class so every
 * route here inherits it (RolesGuard reads the handler, then the class; no
 * route here sets its own @Roles). Cashiers get 403.
 *
 * Units are branch-scoped as the product-units reads are (scopeBranch):
 * admins any branch or all of them, managers only their own, and another
 * branchId is 403 WRONG_BRANCH. Products are shared by every branch.
 *
 * Every response is built field by field: no buying or cost price, no
 * customer, sale or sale line.
 */
@ApiTags('Barcode Labels')
@ApiCookieAuth('access_token')
@Controller('barcode-labels')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class BarcodeLabelsController {
  constructor(private readonly barcodeLabelsService: BarcodeLabelsService) {}

  @Get('products')
  @ApiOperation({
    summary: 'Search products for product-level labels (paginated)',
    description:
      'Admin/Manager only. Active QUANTITY-tracked products: IMEI and ' +
      'serial-number products get unit labels instead. search matches part ' +
      'of the name, SKU or barcode, in any case; % and _ match themselves. ' +
      'Sorted by created_at DESC, id DESC. Pagination: page (default 1), ' +
      'limit (default 50, max 200).\n\n' +
      'The label barcode encodes the product’s `barcode`, which ' +
      'GET /products/by-barcode resolves at the till. Each row carries only ' +
      'what a label prints: no buying or cost price, and no brand, category ' +
      'or branch. Products are shared by every branch, so there is no ' +
      'branch filter.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of product label rows',
    type: ProductLabelSearchResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid query parameter (e.g. search shorter than 2 characters, ' +
      'limit over 200, an unknown parameter)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not an admin or manager' })
  async searchProducts(
    @Query() query: SearchProductLabelsQueryDto,
  ): Promise<ProductLabelSearchResponseDto> {
    return this.barcodeLabelsService.searchProducts(query);
  }

  @Get('units')
  @ApiOperation({
    summary: 'Search individual units for unit labels (paginated)',
    description:
      'Admin/Manager only. IN_STOCK units of active IMEI- or ' +
      'serial-tracked products. search matches part of the IMEI, serial ' +
      'number, unit code, or the product’s SKU or name, in any case; % and ' +
      '_ match themselves. productId narrows to one product. Sorted by ' +
      'created_at DESC, id DESC. Pagination: page (default 1), limit ' +
      '(default 50, max 200).\n\n' +
      'The label barcode encodes `unit_code` (such as SLU00000123), never ' +
      'the IMEI or serial number: the till resolves it with ' +
      'GET /product-units/sellable/by-identifier. `identifier` is the real ' +
      'IMEI or serial number, for readable text only, and ' +
      '`identifier_type` says which. `selling_price` is the unit’s, else ' +
      'the product’s, else null. No buying or cost price, customer or sale.' +
      '\n\nBranch scoping (as GET /product-units): admins see every branch, ' +
      'or the one given in branchId; managers only their own (branchId ' +
      'left out or their own), and another branchId is 403 ' +
      '{ code: WRONG_BRANCH }.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of unit label rows',
    type: UnitLabelSearchResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid query parameter (e.g. search shorter than 2 characters, a ' +
      'malformed branchId or productId, an unknown parameter)',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      'Not an admin or manager, or { message, code: WRONG_BRANCH } for a ' +
      'manager asking for another branch',
  })
  async searchUnits(
    @Query() query: SearchUnitLabelsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnitLabelSearchResponseDto> {
    return this.barcodeLabelsService.searchUnits({
      ...query,
      branchId: scopeBranch(user, query.branchId),
    });
  }

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check a label queue and return its label rows, in order',
    description:
      'Admin/Manager only. Read-only: nothing is saved or changed. Takes a ' +
      'mixed queue of PRODUCT items (a QUANTITY-tracked product and how ' +
      'many copies) and UNIT items (one IMEI- or serial-tracked unit, ' +
      'always one label), and returns one row per item in the order sent, ' +
      'with `total_labels` = the product quantities plus one per unit, at ' +
      'most 500.\n\n' +
      'All or nothing: if any item can’t be printed, the answer is one 400 ' +
      'INVALID_LABEL_ITEMS listing every such item by its index, and no ' +
      'rows. A product must be active and QUANTITY-tracked; a unit must be ' +
      'IN_STOCK, of an active IMEI- or serial-tracked product, and in ' +
      'scope; each product and each unit may appear once.\n\n' +
      'Branch scoping: branchId as for GET /barcode-labels/units. A unit at ' +
      'another branch gets the same UNIT_NOT_FOUND as an unknown one. ' +
      'Products are not branch-specific.',
  })
  @ApiBody({ type: ResolveLabelQueueDto })
  @ApiResponse({
    status: 200,
    description: 'The resolved queue',
    type: ResolvedLabelQueueResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed: items missing, empty or over 500 entries; an ' +
      'unknown type; a missing or malformed productId/unitId; a quantity ' +
      'that is not a whole number from 1 to 500; a field on the wrong kind ' +
      'of item (unitId on PRODUCT, productId or quantity on UNIT); an ' +
      'unknown field. Or { message, code: LABEL_LIMIT_EXCEEDED, ' +
      'total_labels, max_labels } over 500 labels in all. Or { message, ' +
      'code: INVALID_LABEL_ITEMS, errors: [{ index, reason, message }] }, ' +
      'reason one of DUPLICATE_PRODUCT, DUPLICATE_UNIT, PRODUCT_NOT_FOUND, ' +
      'PRODUCT_INACTIVE, PRODUCT_NOT_QUANTITY_TRACKED, UNIT_NOT_FOUND, ' +
      'UNIT_NOT_IN_STOCK, UNIT_PRODUCT_INACTIVE, UNIT_NOT_SERIALIZED.',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description:
      'Not an admin or manager, or { message, code: WRONG_BRANCH } for a ' +
      'manager naming another branch',
  })
  async resolveQueue(
    @Body() dto: ResolveLabelQueueDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolvedLabelQueueResponseDto> {
    return this.barcodeLabelsService.resolveQueue(
      dto,
      scopeBranch(user, dto.branchId),
    );
  }
}
