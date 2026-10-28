import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Branch } from '../src/branches/entities/branch.entity';
import { Product } from '../src/products/entities/product.entity';
import { Stock } from '../src/stock/entities/stock.entity';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';

/**
 * `null` on a NOT NULL field is a 400 naming the field — never a 500, never
 * a silent no-op — while `null` on a nullable field still clears it.
 * Covers the PartialType update DTOs (skipNullProperties: false) and the
 * fields marked @IsOptionalNotNull.
 *
 * One admin session and one set of rows for the whole file; requests are
 * spaced to stay under the API rate limit (10/s, 100/min).
 */
describe('null on required fields (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cookies: string[];
  let ids: Record<string, string>;

  const pause = () => new Promise((r) => setTimeout(r, 650));

  const send = async (method: 'post' | 'patch', path: string, body: object) => {
    await pause();
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookies)
      .send(body);
  };

  const messages = (res: request.Response): string =>
    JSON.stringify(res.body.message);

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);
    await dataSource.getRepository(SkuBarcodeCounter).save([
      { counter_type: 'SKU', prefix: 'SKU-', current_value: 0 },
      { counter_type: 'BARCODE', prefix: 'SLP-', current_value: 0 },
    ] as SkuBarcodeCounter[]);

    const branch = await dataSource.getRepository(Branch).save({
      name: 'Main Shop',
      address: 'Ratnapura',
      phone: '0778822391',
      is_active: true,
    } as Branch);
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Apple', is_active: true } as Brand);
    const parent = await dataSource
      .getRepository(Category)
      .save({ name: 'Accessories', is_active: true } as Category);
    const category = await dataSource.getRepository(Category).save({
      name: 'Cables',
      parent_id: parent.id,
      is_active: true,
    } as Category);
    const password_hash = await bcrypt.hash('testpass123', 4);
    const admin = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: 'admin@t.com',
        password_hash,
        full_name: 'Test Admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
    const cashier = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: 'cashier@t.com',
        password_hash,
        full_name: 'Test Cashier',
        role: UserRole.CASHIER,
        is_active: true,
        branch_id: branch.id,
      }),
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'testpass123' })
      .expect(200);
    cookies = login.headers['set-cookie'] as unknown as string[];

    const product = await send('post', '/products', {
      product_type: 'ACCESSORY',
      name: 'USB-C Cable 1m',
      brand_id: brand.id,
      category_id: category.id,
      branch_id: branch.id,
      buying_price: '500.00',
      selling_price: '1500.00',
      description: 'Braided',
    });
    expect(product.status).toBe(201);
    const stock = await dataSource
      .getRepository(Stock)
      .findOneByOrFail({ product_id: product.body.id, branch_id: branch.id });

    ids = {
      branch: branch.id,
      brand: brand.id,
      category: category.id,
      product: product.body.id,
      stock: stock.id,
      cashier: cashier.id,
    };
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('products', () => {
    it.each([
      ['name', 'name must be a string'],
      ['selling_price', 'selling_price must be a numeric string'],
      ['barcode', 'barcode must not be null'],
      ['barcode_type', 'barcode_type must not be null'],
      ['default_warranty', 'default_warranty must not be null'],
      ['is_serialized', 'is_serialized must not be null'],
      ['is_active', 'is_active must not be null'],
      ['sku', 'sku must not be null'],
    ])(
      'PATCH %s: null → 400',
      async (field, message) => {
        const res = await send('patch', `/products/${ids.product}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(message);
      },
      15_000,
    );

    // These used to return 200 and change nothing (the loaded relation won).
    it.each(['brand_id', 'category_id', 'branch_id'])(
      'PATCH %s: null → 400, not a silent no-op',
      async (field) => {
        const res = await send('patch', `/products/${ids.product}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(`${field} must be a UUID`);
      },
      15_000,
    );

    it('PATCH description / phone_condition: null still clears', async () => {
      const res = await send('patch', `/products/${ids.product}`, {
        description: null,
        phone_condition: null,
      });
      expect(res.status).toBe(200);
      const row = await dataSource
        .getRepository(Product)
        .findOneByOrFail({ id: ids.product });
      expect(row.description).toBeNull();
      expect(row.phone_condition).toBeNull();
    }, 15_000);

    // Nullable since the catalog went global (MakeProductsCatalogGlobal,
    // AddCategoryProductTracking): product_type is deprecated in favour of
    // the category, and the cost is recorded at stock receiving. Both keep
    // @IsOptional, so null clears them like description does.
    it.each(['product_type', 'buying_price'] as const)(
      'PATCH %s: null → 200, clears the nullable column',
      async (field) => {
        const res = await send('patch', `/products/${ids.product}`, {
          [field]: null,
        });
        expect(res.status).toBe(200);
        const row = await dataSource
          .getRepository(Product)
          .findOneByOrFail({ id: ids.product });
        expect(row[field]).toBeNull();
      },
      15_000,
    );

    it('POST with is_active: null → 400', async () => {
      const res = await send('post', '/products', {
        product_type: 'ACCESSORY',
        name: 'Charger',
        brand_id: ids.brand,
        category_id: ids.category,
        branch_id: ids.branch,
        buying_price: '1000.00',
        selling_price: '2000.00',
        is_active: null,
      });
      expect(res.status).toBe(400);
      expect(messages(res)).toContain('is_active must not be null');
    }, 15_000);
  });

  describe('brands', () => {
    it.each([
      ['name', 'name must be a string'],
      ['is_active', 'is_active must not be null'],
    ])(
      'PATCH %s: null → 400',
      async (field, message) => {
        const res = await send('patch', `/brands/${ids.brand}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(message);
      },
      15_000,
    );

    it('POST with is_active: null → 400', async () => {
      const res = await send('post', '/brands', {
        name: 'Samsung',
        is_active: null,
      });
      expect(res.status).toBe(400);
      expect(messages(res)).toContain('is_active must not be null');
    }, 15_000);
  });

  describe('categories', () => {
    it.each([
      ['name', 'name must be a string'],
      ['sort_order', 'sort_order must not be null'],
      ['is_active', 'is_active must not be null'],
    ])(
      'PATCH %s: null → 400',
      async (field, message) => {
        const res = await send('patch', `/categories/${ids.category}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(message);
      },
      15_000,
    );

    it('PATCH parent_id: null still makes it top-level', async () => {
      const res = await send('patch', `/categories/${ids.category}`, {
        parent_id: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.parent_id).toBeNull();
    }, 15_000);
  });

  describe('branches', () => {
    it.each([
      ['name', 'name must be a string'],
      ['is_active', 'is_active must not be null'],
    ])(
      'PATCH %s: null → 400',
      async (field, message) => {
        const res = await send('patch', `/branches/${ids.branch}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(message);
      },
      15_000,
    );

    it('PATCH address / phone: null still clears', async () => {
      const res = await send('patch', `/branches/${ids.branch}`, {
        address: null,
        phone: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.address).toBeNull();
      expect(res.body.phone).toBeNull();
    }, 15_000);
  });

  describe('suppliers', () => {
    let supplierId: string;

    it('POST, then PATCH name / is_active: null → 400', async () => {
      const created = await send('post', '/suppliers', {
        name: 'Friendly Shop',
        contact_person: 'Nimal',
      });
      expect(created.status).toBe(201);
      supplierId = created.body.id;

      const name = await send('patch', `/suppliers/${supplierId}`, {
        name: null,
      });
      expect(name.status).toBe(400);
      expect(messages(name)).toContain('name must be a string');

      const active = await send('patch', `/suppliers/${supplierId}`, {
        is_active: null,
      });
      expect(active.status).toBe(400);
      expect(messages(active)).toContain('is_active must not be null');
    }, 20_000);

    it('PATCH contact_person: null still clears', async () => {
      const res = await send('patch', `/suppliers/${supplierId}`, {
        contact_person: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.contact_person).toBeNull();
    }, 15_000);
  });

  describe('users', () => {
    it.each([
      ['full_name', 'full_name must be a string'],
      ['email', 'Email must be a valid email address'],
    ])(
      'PATCH %s: null → 400',
      async (field, message) => {
        const res = await send('patch', `/users/${ids.cashier}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(message);
      },
      15_000,
    );
  });

  describe('customers', () => {
    let customerId: string;

    it('PATCH name / phone: null → 400', async () => {
      const created = await send('post', '/customers', {
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199012345678',
        email: 'kamal@example.com',
        notes: 'VIP',
      });
      expect(created.status).toBe(201);
      customerId = created.body.id;

      for (const field of ['name', 'phone']) {
        const res = await send('patch', `/customers/${customerId}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(`${field} must not be null`);
      }
    }, 20_000);

    it('PATCH nic / email / notes: null still clears', async () => {
      const res = await send('patch', `/customers/${customerId}`, {
        nic: null,
        email: null,
        notes: null,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nic: null, email: null, notes: null });
    }, 15_000);
  });

  describe('stock', () => {
    it.each(['quantity', 'min_quantity', 'manage_stock'])(
      'PATCH %s: null → 400',
      async (field) => {
        const res = await send('patch', `/stock/${ids.stock}`, {
          [field]: null,
        });
        expect(res.status).toBe(400);
        expect(messages(res)).toContain(`${field} must not be null`);
      },
      15_000,
    );
  });

  describe('sales', () => {
    it('PATCH a line with quantity: null, and a payment with amount: null → 400', async () => {
      const sale = await send('post', '/sales', { branch_id: ids.branch });
      expect(sale.status).toBe(201);
      const withLine = await send('post', `/sales/${sale.body.id}/lines`, {
        product_id: ids.product,
        quantity: 1,
      });
      expect(withLine.status).toBe(201);
      const lineId = withLine.body.lines[0].id as string;

      const qty = await send(
        'patch',
        `/sales/${sale.body.id}/lines/${lineId}`,
        {
          quantity: null,
        },
      );
      expect(qty.status).toBe(400);
      expect(messages(qty)).toContain('quantity must not be null');

      const paid = await send('post', `/sales/${sale.body.id}/payments`, {
        payment_method: 'CASH',
        amount: 1000,
        cash_received: 1000,
      });
      expect(paid.status).toBe(201);
      const paymentId = paid.body.payments[0].id as string;

      const amount = await send(
        'patch',
        `/sales/${sale.body.id}/payments/${paymentId}`,
        { amount: null },
      );
      expect(amount.status).toBe(400);
      expect(messages(amount)).toContain('amount must not be null');
    }, 30_000);
  });
});
