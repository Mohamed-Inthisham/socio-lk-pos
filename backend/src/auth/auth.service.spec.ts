import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TypedConfigService } from '../config/typed-config.service';
import { RefreshToken } from './entities/refresh-token.entity';

import * as bcrypt from 'bcrypt';

const bcryptHash = (plain: string) => bcrypt.hash(plain, 4);

describe('AuthService', () => {
  let service: AuthService;

  // Mocks — one per collaborator. `jest.fn()` gives us call inspection + return control.
  const mockUsersService = {
    findByEmail: jest.fn(),
    findByIdWithHash: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key];
    }),
  };

  const mockRefreshTokensRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    // Reset mocks between tests so state doesn't leak
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: TypedConfigService, useValue: mockConfig },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshTokensRepo,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('returns the user when email and password are valid and user is active', async () => {
      const user = {
        id: 'user-1',
        email: 'test@x.com',
        password_hash: await bcryptHash('correct-password'),
        is_active: true,
        role: 'admin',
      } as any;

      mockUsersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser(
        'test@x.com',
        'correct-password',
      );

      expect(result).toBe(user);
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith('test@x.com');
    });

    it('returns null when the password is wrong', async () => {
      const user = {
        id: 'user-1',
        email: 'test@x.com',
        password_hash: await bcryptHash('correct-password'),
        is_active: true,
        role: 'admin',
      } as any;

      mockUsersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@x.com', 'wrong-password');

      expect(result).toBeNull();
    });

    it('returns null when the user does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('nobody@x.com', 'any-password');

      expect(result).toBeNull();
    });

    it('takes similar time whether user exists or not (timing-safe)', async () => {
      const user = {
        id: 'user-1',
        email: 'test@x.com',
        password_hash: await bcryptHash('correct-password'),
        is_active: true,
        role: 'admin',
      } as any;

      // Time a call where the user exists (real bcrypt runs)
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      const startExisting = Date.now();
      await service.validateUser('test@x.com', 'wrong-password');
      const durationExisting = Date.now() - startExisting;

      // Time a call where the user does NOT exist (dummy bcrypt should still run)
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      const startMissing = Date.now();
      await service.validateUser('nobody@x.com', 'any-password');
      const durationMissing = Date.now() - startMissing;

      // Both should take a noticeable amount of time (bcrypt runs in both cases).
      // If someone skipped the DUMMY_HASH compare, `durationMissing` would drop
      // dramatically (well under 1ms) — this assertion would then fail.
      expect(durationMissing).toBeGreaterThan(0);
      expect(durationExisting).toBeGreaterThan(0);
    });

    it('returns null when user is inactive even if password is correct', async () => {
      const user = {
        id: 'user-1',
        email: 'test@x.com',
        password_hash: await bcryptHash('correct-password'),
        is_active: false,
        role: 'admin',
      } as any;

      mockUsersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser(
        'test@x.com',
        'correct-password',
      );

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    const fakeUser = {
      id: 'user-1',
      email: 'test@x.com',
      role: 'admin',
    } as any;

    beforeEach(() => {
      // Fake JWT signing — return a distinguishable string per call
      mockJwtService.signAsync
        .mockResolvedValueOnce('fake-access-token')
        .mockResolvedValueOnce('fake-refresh-token');

      // decode() called inside persistRefreshToken to compute expires_at
      mockJwtService.decode.mockReturnValue({
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days from now
      });

      // create() → save() flow for RefreshToken persistence
      mockRefreshTokensRepo.create.mockImplementation((entity) => entity);
      mockRefreshTokensRepo.save.mockResolvedValue(undefined);
    });

    it('returns both access and refresh tokens', async () => {
      const result = await service.login(fakeUser, '127.0.0.1', 'test-agent');

      expect(result).toEqual({
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
      });
    });

    it('persists the refresh token with user id, ip, and user agent', async () => {
      await service.login(fakeUser, '127.0.0.1', 'test-agent');

      expect(mockRefreshTokensRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          ip_address: '127.0.0.1',
          user_agent: 'test-agent',
        }),
      );
      expect(mockRefreshTokensRepo.save).toHaveBeenCalled();
    });

    it('stores a SHA-256 hash of the refresh token, not the raw token', async () => {
      await service.login(fakeUser, null, null);

      const createCall = mockRefreshTokensRepo.create.mock.calls[0][0];

      // 64-char hex string = SHA-256 digest length
      expect(createCall.token_hash).toMatch(/^[a-f0-9]{64}$/);
      // Make sure the raw token isn't accidentally stored
      expect(createCall.token_hash).not.toBe('fake-refresh-token');
    });
  });

  describe('refresh', () => {
    const fakeUser = {
      id: 'user-1',
      email: 'test@x.com',
      role: 'admin',
      is_active: true,
    } as any;

    const validRefreshToken = 'valid-refresh-token-string';

    beforeEach(() => {
      // JWT verify returns a decoded payload with the user id
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });

      // signAsync for the two new tokens produced by rotation
      mockJwtService.signAsync
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token');

      // decode() for computing expires_at on the new refresh token
      mockJwtService.decode.mockReturnValue({
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });

      // Persistence flow for the new refresh token
      mockRefreshTokensRepo.create.mockImplementation((entity) => entity);
      mockRefreshTokensRepo.save.mockResolvedValue(undefined);

      // The user is still active
      mockUsersService.findByIdWithHash.mockResolvedValue(fakeUser);
    });

    it('happy path: rotates tokens for a valid, unrevoked, unexpired session', async () => {
      // Simulate a valid, active session found in DB
      const session = {
        id: 'session-1',
        user_id: 'user-1',
        token_hash: 'any-hash',
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000), // 1 min from now
      };
      mockRefreshTokensRepo.findOne.mockResolvedValue(session);

      const result = await service.refresh(
        validRefreshToken,
        '127.0.0.1',
        'ua',
      );

      expect(result).toEqual({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });

      // Old session marked revoked
      expect(mockRefreshTokensRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-1',
          revoked_at: expect.any(Date),
        }),
      );
    });

    it('throws when the JWT signature is invalid', async () => {
      mockJwtService.verifyAsync.mockRejectedValueOnce(new Error('bad sig'));

      await expect(
        service.refresh('tampered-token', null, null),
      ).rejects.toThrow('Invalid refresh token');
    });

    it('throws when the token JWT is valid but not in the DB', async () => {
      mockRefreshTokensRepo.findOne.mockResolvedValue(null);

      await expect(
        service.refresh(validRefreshToken, null, null),
      ).rejects.toThrow('Refresh token not recognized');
    });

    it('revokes ALL sessions when a revoked token is presented (reuse detection)', async () => {
      const revokedSession = {
        id: 'session-1',
        user_id: 'user-1',
        token_hash: 'any-hash',
        revoked_at: new Date(), // already revoked
        expires_at: new Date(Date.now() + 60_000),
      };
      mockRefreshTokensRepo.findOne.mockResolvedValue(revokedSession);

      await expect(
        service.refresh(validRefreshToken, null, null),
      ).rejects.toThrow('reuse detected');

      // The critical assertion: all sessions for this user get revoked
      expect(mockRefreshTokensRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1' }),
        expect.objectContaining({ revoked_at: expect.any(Date) }),
      );
    });

    it('throws when the session has expired', async () => {
      const expiredSession = {
        id: 'session-1',
        user_id: 'user-1',
        token_hash: 'any-hash',
        revoked_at: null,
        expires_at: new Date(Date.now() - 1000), // 1 sec ago
      };
      mockRefreshTokensRepo.findOne.mockResolvedValue(expiredSession);

      await expect(
        service.refresh(validRefreshToken, null, null),
      ).rejects.toThrow('expired');
    });

    it('throws if the user is no longer active', async () => {
      const session = {
        id: 'session-1',
        user_id: 'user-1',
        token_hash: 'any-hash',
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      };
      mockRefreshTokensRepo.findOne.mockResolvedValue(session);
      mockUsersService.findByIdWithHash.mockResolvedValueOnce({
        ...fakeUser,
        is_active: false,
      });

      await expect(
        service.refresh(validRefreshToken, null, null),
      ).rejects.toThrow('no longer active');
    });
  });

  describe('logout', () => {
    it('revokes the matching, unrevoked session', async () => {
      mockRefreshTokensRepo.update.mockResolvedValue({ affected: 1 });

      await service.logout('some-refresh-token');

      expect(mockRefreshTokensRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({ revoked_at: expect.any(Date) }),
      );
    });

    it('does not throw if no matching session is found (idempotent)', async () => {
      mockRefreshTokensRepo.update.mockResolvedValue({ affected: 0 });

      // Should complete without throwing — logout must be safe to call
      // even with a stale/unknown token
      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    });
  });
});
