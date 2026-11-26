import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierReturnDto } from './create-supplier-return.dto';
import { SupplierReturnReason } from '../enums/supplier-return-reason.enum';

const uuid1 = '9ca1d955-a13c-4afe-9fdb-ffbd5542f002';
const uuid2 = 'b70eed4a-b250-4d3e-b4e0-5fbc1fb11587';
const uuid3 = '8721e018-e3b5-4291-9ceb-550c1a34f873';

const payload = (overrides: Record<string, unknown> = {}) => ({
  client_request_id: uuid1,
  stock_purchase_id: uuid2,
  reason_code: SupplierReturnReason.DAMAGED,
  items: [
    {
      stock_purchase_item_id: uuid3,
      quantity: 2,
      product_unit_ids: [],
    },
  ],
  ...overrides,
});

const validatePayload = async (value: Record<string, unknown>) => {
  const dto = plainToInstance(CreateSupplierReturnDto, value);
  return { dto, errors: await validate(dto) };
};

describe('CreateSupplierReturnDto', () => {
  it('accepts a valid return request and trims an optional note', async () => {
    const { dto, errors } = await validatePayload(
      payload({ note: '  Packaging was damaged.  ' }),
    );

    expect(errors).toHaveLength(0);
    expect(dto.note).toBe('Packaging was damaged.');
  });

  it('requires a nonblank explanation for OTHER', async () => {
    const missing = await validatePayload(
      payload({ reason_code: SupplierReturnReason.OTHER }),
    );
    const blank = await validatePayload(
      payload({ reason_code: SupplierReturnReason.OTHER, note: '   ' }),
    );

    expect(missing.errors.length).toBeGreaterThan(0);
    expect(blank.errors.length).toBeGreaterThan(0);
  });

  it('allows an absent or null note for reasons other than OTHER', async () => {
    const absent = await validatePayload(payload());
    const nullNote = await validatePayload(payload({ note: null }));

    expect(absent.errors).toHaveLength(0);
    expect(nullNote.errors).toHaveLength(0);
  });

  it('rejects notes longer than 500 characters', async () => {
    const { errors } = await validatePayload(
      payload({ note: 'x'.repeat(501) }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects repeated purchase lines and repeated units across lines', async () => {
    const duplicatedItem = await validatePayload(
      payload({
        items: [
          { stock_purchase_item_id: uuid3, quantity: 1 },
          { stock_purchase_item_id: uuid3, quantity: 1 },
        ],
      }),
    );
    const duplicatedUnit = await validatePayload(
      payload({
        items: [
          {
            stock_purchase_item_id: uuid3,
            quantity: 1,
            product_unit_ids: [uuid1],
          },
          {
            stock_purchase_item_id: uuid2,
            quantity: 1,
            product_unit_ids: [uuid1],
          },
        ],
      }),
    );

    expect(duplicatedItem.errors.length).toBeGreaterThan(0);
    expect(duplicatedUnit.errors.length).toBeGreaterThan(0);
  });

  it('treats mixed-case UUIDs as duplicate unit identifiers', async () => {
    const { errors } = await validatePayload(
      payload({
        items: [
          {
            stock_purchase_item_id: uuid3,
            quantity: 1,
            product_unit_ids: [uuid1],
          },
          {
            stock_purchase_item_id: uuid2,
            quantity: 1,
            product_unit_ids: [uuid1.toUpperCase()],
          },
        ],
      }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it.each([
    ['null item', [null]],
    ['string item', ['invalid line']],
    ['number item', [42]],
  ])('returns validation errors for a %s', async (_label, items) => {
    const { errors } = await validatePayload(payload({ items }));

    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(['not-an-array', { id: uuid1 }])(
    'returns validation errors when product_unit_ids is malformed (%p)',
    async (product_unit_ids) => {
      const { errors } = await validatePayload(
        payload({
          items: [
            { stock_purchase_item_id: uuid3, quantity: 1, product_unit_ids },
          ],
        }),
      );

      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('allows missing and empty product_unit_ids', async () => {
    const missing = await validatePayload(
      payload({
        items: [{ stock_purchase_item_id: uuid3, quantity: 1 }],
      }),
    );
    const empty = await validatePayload(
      payload({
        items: [
          { stock_purchase_item_id: uuid3, quantity: 1, product_unit_ids: [] },
        ],
      }),
    );

    expect(missing.errors).toHaveLength(0);
    expect(empty.errors).toHaveLength(0);
  });

  it('rejects more identified units than the line quantity', async () => {
    const { errors } = await validatePayload(
      payload({
        items: [
          {
            stock_purchase_item_id: uuid3,
            quantity: 1,
            product_unit_ids: [uuid1, uuid2],
          },
        ],
      }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});
