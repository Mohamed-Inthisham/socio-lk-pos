import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { BarcodeLabelsController } from './barcode-labels.controller';
import { BarcodeLabelsService } from './barcode-labels.service';

type Schema = {
  type?: string;
  properties?: Record<string, Schema & { $ref?: string; items?: Schema }>;
  required?: string[];
  enum?: unknown[];
  nullable?: boolean;
  items?: Schema & {
    oneOf?: { $ref: string }[];
    discriminator?: { propertyName: string; mapping: Record<string, string> };
    $ref?: string;
  };
  $ref?: string;
};

/**
 * The Swagger document for the label endpoints, built the way main.ts
 * builds it, from an app holding only BarcodeLabelsController and a stub
 * service: no database, no other module.
 */
describe('Barcode labels Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  let schemas: Record<string, Schema>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BarcodeLabelsController],
      providers: [{ provide: BarcodeLabelsService, useValue: {} }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addCookieAuth('access_token').build(),
    );
    schemas = document.components!.schemas as Record<string, Schema>;
  });

  afterAll(async () => {
    await app.close();
  });

  const propsOf = (name: string) =>
    Object.keys(schemas[name].properties ?? {}).sort();

  it('documents the three routes under Barcode Labels, cookie-authenticated', () => {
    const products = document.paths['/api/v1/barcode-labels/products'].get!;
    const units = document.paths['/api/v1/barcode-labels/units'].get!;
    const resolve = document.paths['/api/v1/barcode-labels/resolve'].post!;

    for (const operation of [products, units, resolve]) {
      expect(operation.tags).toEqual(['Barcode Labels']);
      expect(operation.security).toEqual([{ access_token: [] }]);
      expect(Object.keys(operation.responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '403',
      ]);
    }
    expect(resolve.responses['201']).toBeUndefined();
  });

  it('documents the query parameters', () => {
    const names = (path: string) =>
      (document.paths[path].get!.parameters as { name: string }[])
        .map((p) => p.name)
        .sort();

    expect(names('/api/v1/barcode-labels/products')).toEqual([
      'limit',
      'page',
      'search',
    ]);
    expect(names('/api/v1/barcode-labels/units')).toEqual([
      'branchId',
      'limit',
      'page',
      'productId',
      'search',
    ]);
  });

  it('links each route to its response schema', () => {
    const ref = (path: string, method: 'get' | 'post') =>
      (
        document.paths[path][method]!.responses['200'] as {
          content: Record<string, { schema: { $ref: string } }>;
        }
      ).content['application/json'].schema.$ref;

    expect(ref('/api/v1/barcode-labels/products', 'get')).toBe(
      '#/components/schemas/ProductLabelSearchResponseDto',
    );
    expect(ref('/api/v1/barcode-labels/units', 'get')).toBe(
      '#/components/schemas/UnitLabelSearchResponseDto',
    );
    expect(ref('/api/v1/barcode-labels/resolve', 'post')).toBe(
      '#/components/schemas/ResolvedLabelQueueResponseDto',
    );
  });

  it('documents the label rows with exactly their fields, and no cost field anywhere', () => {
    expect(propsOf('ProductLabelRowDto')).toEqual([
      'barcode',
      'barcode_type',
      'kind',
      'model',
      'name',
      'product_id',
      'selling_price',
      'sku',
    ]);
    expect(propsOf('UnitLabelRowDto')).toEqual([
      'branch',
      'identifier',
      'identifier_type',
      'kind',
      'name',
      'product_id',
      'selling_price',
      'tracking_method',
      'unit_code',
      'unit_id',
    ]);
    expect(propsOf('LabelBranchDto')).toEqual(['id', 'name']);
    expect(schemas.ProductLabelRowDto.properties!.selling_price.nullable).toBe(
      true,
    );
    expect(schemas.UnitLabelRowDto.properties!.selling_price.nullable).toBe(
      true,
    );
    expect(schemas.ProductLabelRowDto.properties!.kind.enum).toEqual([
      'PRODUCT',
    ]);
    expect(schemas.UnitLabelRowDto.properties!.kind.enum).toEqual(['UNIT']);
    expect(schemas.UnitLabelRowDto.properties!.identifier_type.enum).toEqual([
      'IMEI',
      'SERIAL_NUMBER',
    ]);
    expect(JSON.stringify(schemas)).not.toMatch(
      /buying|cost_price|customer|sale_line/,
    );
  });

  it('carries the inherited fields onto the queue item schemas', () => {
    expect(propsOf('ResolvedProductQueueItemDto')).toEqual(
      [...propsOf('ProductLabelRowDto'), 'quantity'].sort(),
    );
    expect(propsOf('ResolvedUnitQueueItemDto')).toEqual(
      propsOf('UnitLabelRowDto'),
    );
  });

  it('documents the queue as oneOf the two item schemas, discriminated by kind', () => {
    const data = schemas.ResolvedLabelQueueResponseDto.properties!.data;

    expect(data.type).toBe('array');
    expect(data.items).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/ResolvedProductQueueItemDto' },
        { $ref: '#/components/schemas/ResolvedUnitQueueItemDto' },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          PRODUCT: '#/components/schemas/ResolvedProductQueueItemDto',
          UNIT: '#/components/schemas/ResolvedUnitQueueItemDto',
        },
      },
    });
    expect(propsOf('ResolvedLabelQueueResponseDto')).toEqual([
      'data',
      'total_labels',
    ]);
  });

  it('documents the paginated responses as { data, meta }', () => {
    for (const name of [
      'ProductLabelSearchResponseDto',
      'UnitLabelSearchResponseDto',
    ]) {
      expect(propsOf(name)).toEqual(['data', 'meta']);
      expect(schemas[name].properties!.meta.$ref).toBe(
        '#/components/schemas/PaginationMeta',
      );
    }
    expect(
      schemas.UnitLabelSearchResponseDto.properties!.data.items!.$ref,
    ).toBe('#/components/schemas/UnitLabelRowDto');
  });

  it('documents the resolve body and its items', () => {
    const requestBody = document.paths['/api/v1/barcode-labels/resolve'].post!
      .requestBody as { content: Record<string, { schema: { $ref: string } }> };
    expect(requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ResolveLabelQueueDto',
    );
    expect(propsOf('ResolveLabelQueueDto')).toEqual(['branchId', 'items']);
    expect(schemas.ResolveLabelQueueDto.required).toEqual(['items']);
    expect(propsOf('LabelQueueItemDto')).toEqual([
      'productId',
      'quantity',
      'type',
      'unitId',
    ]);
    expect(schemas.LabelQueueItemDto.required).toEqual(['type']);
    expect(schemas.LabelQueueItemDto.properties!.type.enum).toEqual([
      'PRODUCT',
      'UNIT',
    ]);
  });
});
