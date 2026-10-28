import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Server } from 'http';
import request from 'supertest';
import { applyTrustProxy, TrustProxySetting } from './trust-proxy';

@Controller()
class IpController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

/**
 * req.ip and the throttler's key over real HTTP, with TRUST_PROXY applied
 * the way main.ts and the e2e app apply it. supertest connects from
 * loopback, so loopback stands in for the proxy in front of the API.
 */
describe('TRUST_PROXY over HTTP', () => {
  const LIMIT = 2;
  let app: INestApplication<Server>;

  async function start(setting: TrustProxySetting) {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: LIMIT }])],
      controllers: [IpController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    const nest = module.createNestApplication<NestExpressApplication>();
    applyTrustProxy(nest, setting);
    await nest.init();
    app = nest;
  }

  afterEach(async () => {
    await app?.close();
  });

  const get = (xff?: string) => {
    const req = request(app.getHttpServer()).get('/ip');
    return xff === undefined ? req : req.set('X-Forwarded-For', xff);
  };
  const ipOf = (response: request.Response) =>
    (response.body as { ip: string }).ip;
  const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

  describe('no proxy trusted (default)', () => {
    beforeEach(() => start(false));

    it('uses the connected peer for a direct request', async () => {
      expect(ipOf(await get().expect(200))).toMatch(LOOPBACK);
    });

    it('ignores a client-sent X-Forwarded-For', async () => {
      expect(ipOf(await get('203.0.113.7').expect(200))).toMatch(LOOPBACK);
    });

    it('a new spoofed address per request gets no new throttle allowance', async () => {
      for (let i = 1; i <= LIMIT; i++) {
        await get(`198.51.100.${i}`).expect(200);
      }
      await get('198.51.100.99').expect(429);
    });
  });

  describe.each<[string, TrustProxySetting]>([
    ['one hop', 1],
    ['an allowlist', ['loopback']],
  ])('trusting the proxy (%s)', (_, setting) => {
    beforeEach(() => start(setting));

    it('uses the address the trusted proxy appended', async () => {
      expect(ipOf(await get('203.0.113.7').expect(200))).toBe('203.0.113.7');
    });

    it('ignores entries the client put in front of it', async () => {
      expect(ipOf(await get('6.6.6.6, 203.0.113.7').expect(200))).toBe(
        '203.0.113.7',
      );
    });

    it('throttles by that address, however the client spoofs the rest', async () => {
      for (let i = 1; i <= LIMIT; i++) {
        await get(`6.6.6.${i}, 203.0.113.7`).expect(200);
      }
      await get('6.6.6.99, 203.0.113.7').expect(429);
      // Another client behind the same proxy has its own allowance.
      await get('203.0.113.8').expect(200);
    });

    it('falls back to the peer when no X-Forwarded-For is sent', async () => {
      expect(ipOf(await get().expect(200))).toMatch(LOOPBACK);
    });
  });

  it('an allowlist that doesn’t include the peer ignores X-Forwarded-For', async () => {
    await start(['10.0.0.0/8']);
    expect(ipOf(await get('203.0.113.7').expect(200))).toMatch(LOOPBACK);
  });
});
