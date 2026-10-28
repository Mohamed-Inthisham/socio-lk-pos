import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type { Server } from 'http';
import { SalesController } from '../sales.controller';
import { SalesService } from '../sales.service';
import { Sale } from '../entities/sale.entity';
import { SaleBranchGuard } from './sale-branch.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { UserRole } from '../../users/enums/user-role.enum';

const saleId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const otherBranchId = '44444444-4444-4444-8444-444444444444';

const operations = [
  {
    method: 'patch',
    path: '',
    handler: 'update',
    body: { notes: 'Updated' },
    status: 200,
  },
  {
    method: 'delete',
    path: '',
    handler: 'discardDraft',
    body: {},
    status: 204,
  },
  {
    method: 'post',
    path: '/lines',
    handler: 'addLine',
    body: { product_id: childId, quantity: 1 },
    status: 201,
  },
  {
    method: 'patch',
    path: `/lines/${childId}`,
    handler: 'updateLine',
    body: { quantity: 2 },
    status: 200,
  },
  {
    method: 'delete',
    path: `/lines/${childId}`,
    handler: 'removeLine',
    body: {},
    status: 204,
  },
  {
    method: 'post',
    path: '/payments',
    handler: 'addPayment',
    body: { payment_method: 'CASH', amount: 100, cash_received: 100 },
    status: 201,
  },
  {
    method: 'patch',
    path: `/payments/${childId}`,
    handler: 'updatePayment',
    body: { amount: 100 },
    status: 200,
  },
  {
    method: 'delete',
    path: `/payments/${childId}`,
    handler: 'removePayment',
    body: {},
    status: 204,
  },
  {
    method: 'post',
    path: '/complete',
    handler: 'completeSale',
    body: {},
    status: 200,
  },
] as const;

/**
 * Real Nest routing, role guard, branch guard and DTO validation, with an
 * authenticated server-context fixture and mocked persistence/services.
 * No AppModule, database connection, migration or truncation is used.
 */
describe('Sale mutation branch authorization (HTTP, no database)', () => {
  let app: INestApplication<Server>;
  let sessionUser: AuthenticatedUser | undefined;
  const repository = { findOne: jest.fn() };
  const services = Object.fromEntries(
    [...operations.map((op) => op.handler), 'findOne'].map((name) => [
      name,
      jest.fn(),
    ]),
  ) as Record<string, jest.Mock>;

  const user = (
    role: UserRole,
    assignedBranch: string | null,
  ): AuthenticatedUser => ({
    id: childId,
    email: 'staff@example.test',
    full_name: 'Staff',
    role,
    branch_id: assignedBranch,
    branch: null,
    has_approval_pin: false,
    approval_pin_set_at: null,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        SaleBranchGuard,
        { provide: getRepositoryToken(Sale), useValue: repository },
        { provide: SalesService, useValue: services },
      ],
    }).compile();
    app = module.createNestApplication();
    // JWT verification is covered by the auth suites. Here only this
    // server-side fixture supplies request.user; request bodies never do.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = sessionUser;
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findOne.mockResolvedValue({ id: saleId, branch_id: branchId });
    services.findOne.mockResolvedValue({ id: saleId });
    services.update.mockResolvedValue({ id: saleId });
    sessionUser = user(UserRole.CASHIER, branchId);
  });

  const expectNoBusinessCalls = () => {
    // If the handlers never run, neither their transaction nor any sale,
    // payment, stock, unit-status, numbering or audit write can run.
    for (const spy of Object.values(services))
      expect(spy).not.toHaveBeenCalled();
  };

  describe.each(operations)('$method /sales/:id$path', (op) => {
    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER])(
      'allows %s in the permitted branch (admin cross-branch)',
      async (role) => {
        sessionUser = user(
          role,
          role === UserRole.ADMIN ? otherBranchId : branchId,
        );
        await request(app.getHttpServer())
          [op.method](`/api/v1/sales/${saleId}${op.path}`)
          .send(op.body)
          .expect(op.status);
        expect(services[op.handler]).toHaveBeenCalledTimes(1);
      },
    );

    it.each([UserRole.MANAGER, UserRole.CASHIER])(
      'rejects cross-branch %s before any business operation, ignoring spoofed body context',
      async (role) => {
        sessionUser = user(role, otherBranchId);
        const response = await request(app.getHttpServer())
          [op.method](`/api/v1/sales/${saleId}${op.path}`)
          .send({
            ...op.body,
            branch_id: branchId,
            role: 'admin',
            user: user(UserRole.ADMIN, null),
          })
          .expect(403);
        expect(response.body).toEqual({
          message: 'You can only modify sales at your own branch.',
          code: 'SALE_WRONG_BRANCH',
        });
        expectNoBusinessCalls();
        expect(repository.findOne).toHaveBeenCalledWith({
          where: { id: saleId },
          select: { id: true, branch_id: true },
        });
      },
    );
  });

  it('fails closed for staff without an assigned branch', async () => {
    sessionUser = user(UserRole.CASHIER, null);
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/complete`)
      .expect(403);
    expectNoBusinessCalls();
  });

  it('does not disclose sale state or nested information on refusal', async () => {
    sessionUser = user(UserRole.MANAGER, otherBranchId);
    repository.findOne.mockResolvedValue({
      id: saleId,
      branch_id: branchId,
      status: 'COMPLETED',
      total: '999.00',
      payments: [{ id: childId }],
    });
    const response = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/complete`)
      .expect(403);
    expect(
      Object.keys(response.body as Record<string, unknown>).sort(),
    ).toEqual(['code', 'message']);
    expectNoBusinessCalls();
  });

  it('returns 404 for an unknown sale without reaching a handler', async () => {
    repository.findOne.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/complete`)
      .expect(404);
    expectNoBusinessCalls();
  });

  it('rejects malformed parent IDs before querying persistence', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/sales/invalid/complete')
      .expect(400);
    expect(repository.findOne).not.toHaveBeenCalled();
    expectNoBusinessCalls();
  });

  it('rejects a missing authenticated context before querying persistence', async () => {
    sessionUser = undefined;
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/complete`)
      .expect(403);
    expect(repository.findOne).not.toHaveBeenCalled();
    expectNoBusinessCalls();
  });
});
