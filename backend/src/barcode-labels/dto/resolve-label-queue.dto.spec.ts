import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ResolveLabelQueueDto } from './resolve-label-queue.dto';
import { SearchProductLabelsQueryDto } from './search-product-labels-query.dto';
import { SearchUnitLabelsQueryDto } from './search-unit-labels-query.dto';

/**
 * The request DTOs through the same ValidationPipe main.ts and the e2e app
 * install (whitelist, forbidNonWhitelisted, transform, no implicit
 * conversion). No app, no database.
 */
describe('Barcode label request validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  const P1 = '11111111-1111-4111-8111-111111111111';
  const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const body = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: ResolveLabelQueueDto,
    }) as Promise<ResolveLabelQueueDto>;
  const query = (metatype: ArgumentMetadata['metatype'], value: unknown) =>
    pipe.transform(value, { type: 'query', metatype });

  /** The pipe's messages for a refused value. */
  async function refused(promise: Promise<unknown>): Promise<string[]> {
    const error = await promise.then(
      () => {
        throw new Error('expected a 400');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }

  describe('POST /barcode-labels/resolve body', () => {
    it('accepts a mixed queue and keeps its order and types', async () => {
      const dto = await body({
        branchId: '22222222-2222-4222-8222-222222222222',
        items: [
          { type: 'UNIT', unitId: U1 },
          { type: 'PRODUCT', productId: P1, quantity: 2 },
        ],
      });

      expect(dto.items).toEqual([
        { type: 'UNIT', unitId: U1 },
        { type: 'PRODUCT', productId: P1, quantity: 2 },
      ]);
    });

    it('accepts a queue without branchId', async () => {
      await expect(
        body({ items: [{ type: 'UNIT', unitId: U1 }] }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['missing', {}],
      ['not an array', { items: 'x' }],
      ['empty', { items: [] }],
    ])('refuses items %s', async (_label, value) => {
      await refused(body(value));
    });

    it('refuses more than 500 items', async () => {
      const items = Array.from({ length: 501 }, () => ({
        type: 'UNIT',
        unitId: U1,
      }));

      const messages = await refused(body({ items }));

      expect(messages).toContain(
        'items must contain no more than 500 elements',
      );
    });

    it.each([null, 'x', 7, ['nested']])(
      'refuses a %p element with a 400, not a 500',
      async (element) => {
        await refused(body({ items: [element] }));
      },
    );

    it.each([undefined, 'BOTH', 'product', null])(
      'refuses type %p',
      async (type) => {
        await refused(body({ items: [{ type, productId: P1, quantity: 1 }] }));
      },
    );

    it.each([0, -1, 501, 2.5, '2', null])(
      'refuses PRODUCT quantity %p',
      async (quantity) => {
        await refused(
          body({ items: [{ type: 'PRODUCT', productId: P1, quantity }] }),
        );
      },
    );

    it('accepts PRODUCT quantity 1 and 500', async () => {
      await expect(
        body({ items: [{ type: 'PRODUCT', productId: P1, quantity: 1 }] }),
      ).resolves.toBeDefined();
      await expect(
        body({ items: [{ type: 'PRODUCT', productId: P1, quantity: 500 }] }),
      ).resolves.toBeDefined();
    });

    it('requires productId and quantity on a PRODUCT item', async () => {
      const messages = await refused(body({ items: [{ type: 'PRODUCT' }] }));

      expect(messages).toEqual(
        expect.arrayContaining([
          'items.0.productId must be a UUID',
          'items.0.quantity must be an integer number',
        ]),
      );
    });

    it('requires unitId on a UNIT item', async () => {
      const messages = await refused(body({ items: [{ type: 'UNIT' }] }));

      expect(messages).toContain('items.0.unitId must be a UUID');
    });

    it.each(['not-a-uuid', '', 123])(
      'refuses a malformed id %p',
      async (id) => {
        await refused(body({ items: [{ type: 'UNIT', unitId: id }] }));
        await refused(
          body({ items: [{ type: 'PRODUCT', productId: id, quantity: 1 }] }),
        );
      },
    );

    it('refuses fields that belong to the other kind of item', async () => {
      const onProduct = await refused(
        body({
          items: [{ type: 'PRODUCT', productId: P1, quantity: 1, unitId: U1 }],
        }),
      );
      expect(onProduct).toContain(
        'items.0.unitId is only allowed on UNIT items',
      );

      const onUnit = await refused(
        body({
          items: [{ type: 'UNIT', unitId: U1, productId: P1, quantity: 3 }],
        }),
      );
      expect(onUnit).toEqual(
        expect.arrayContaining([
          'items.0.productId is only allowed on PRODUCT items',
          'items.0.quantity is only allowed on PRODUCT items',
        ]),
      );
    });

    it('refuses unknown fields on an item and on the body', async () => {
      const onItem = await refused(
        body({ items: [{ type: 'UNIT', unitId: U1, buying_price: '1.00' }] }),
      );
      expect(onItem).toContain(
        'items.0.property buying_price should not exist',
      );

      await refused(
        body({ items: [{ type: 'UNIT', unitId: U1 }], extra: true }),
      );
    });

    it('refuses a malformed branchId', async () => {
      await refused(
        body({ branchId: 'branch-a', items: [{ type: 'UNIT', unitId: U1 }] }),
      );
    });
  });

  describe('query DTOs', () => {
    it.each([SearchProductLabelsQueryDto, SearchUnitLabelsQueryDto])(
      '%p trims search, ignores an empty one, and applies the paging defaults',
      async (metatype) => {
        const trimmed = (await query(metatype, { search: '  cable  ' })) as {
          search?: string;
          page?: number;
          limit?: number;
        };
        expect(trimmed).toMatchObject({ search: 'cable', page: 1, limit: 50 });

        const empty = (await query(metatype, { search: '   ' })) as {
          search?: string;
        };
        expect(empty.search).toBeUndefined();
      },
    );

    it.each([SearchProductLabelsQueryDto, SearchUnitLabelsQueryDto])(
      '%p refuses a 1-character or 101-character search, limit over 200, and unknown params',
      async (metatype) => {
        await refused(query(metatype, { search: ' a ' }));
        await refused(query(metatype, { search: 'x'.repeat(101) }));
        await refused(query(metatype, { limit: '201' }));
        await refused(query(metatype, { page: '0' }));
        await refused(query(metatype, { trackingMethod: 'IMEI' }));
      },
    );

    it('converts page and limit from query strings', async () => {
      const dto = (await query(SearchUnitLabelsQueryDto, {
        page: '2',
        limit: '10',
      })) as {
        page: number;
        limit: number;
      };
      expect(dto).toMatchObject({ page: 2, limit: 10 });
    });

    it('refuses a malformed branchId or productId on the unit search', async () => {
      await refused(query(SearchUnitLabelsQueryDto, { branchId: 'branch-a' }));
      await refused(query(SearchUnitLabelsQueryDto, { productId: 'p-1' }));
    });

    it('has no branchId on the product search', async () => {
      await refused(
        query(SearchProductLabelsQueryDto, {
          branchId: '22222222-2222-4222-8222-222222222222',
        }),
      );
    });
  });
});
