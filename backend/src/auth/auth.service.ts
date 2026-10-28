import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UsersService } from '../users/users.service';
import { TypedConfigService } from '../config/typed-config.service';
import { TokensDto } from './dto/tokens.dto';

const DUMMY_HASH =
  '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV.';

/** What rotate() decided; refresh() throws a refusal after the commit. */
type RotateOutcome =
  | { ok: true; tokens: TokensDto }
  | { ok: false; reuse: boolean; error: UnauthorizedException };

const refuse = (message: string): RotateOutcome => ({
  ok: false,
  reuse: false,
  error: new UnauthorizedException(message),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: TypedConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepo: Repository<RefreshToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    const hashToCompare = user?.password_hash ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches) return null;
    if (!user.is_active) return null;

    return user;
  }

  async login(
    user: User,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<TokensDto> {
    const tokens = await this.generateTokens(user);
    await this.persistRefreshToken(
      this.refreshTokensRepo,
      user.id,
      tokens.refresh_token,
      ipAddress,
      userAgent,
    );
    return tokens;
  }

  async refresh(
    refreshToken: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<TokensDto> {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const outcome = await this.dataSource.transaction((manager) =>
      this.rotate(
        manager,
        this.hashToken(refreshToken),
        payload.sub,
        ipAddress,
        userAgent,
      ),
    );
    if (outcome.ok) return outcome.tokens;

    // After the commit, so it sees (and revokes) a replacement minted by a
    // concurrent refresh that won the claim.
    if (outcome.reuse) await this.revokeAllUserSessions(payload.sub);
    throw outcome.error;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokensRepo.update(
      { token_hash: tokenHash, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  // ---------- private helpers ----------

  /**
   * Claim the presented token and mint its replacement, inside refresh()'s
   * transaction.
   *
   * The claim is one conditional UPDATE. Concurrent claims of the same row
   * queue on its row lock; under READ COMMITTED each waiter re-checks the
   * WHERE against the committed row, so exactly one claim returns a row and
   * the rest see it revoked. Logout's conditional UPDATE takes the same lock,
   * so refresh and logout can't both win either.
   *
   * Refusals are returned, not thrown, so the transaction commits: a claimed
   * token stays revoked even when the user turns out to be inactive. A
   * failure minting the replacement throws and rolls the claim back, leaving
   * the old token usable for a retry.
   */
  private async rotate(
    manager: EntityManager,
    tokenHash: string,
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<RotateOutcome> {
    const claim = await manager
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > now()')
      .returning('user_id')
      .execute();
    const claimed = (claim.raw as { user_id: string }[])[0];

    if (!claimed) {
      // Nothing claimed: say why, in the order refresh has always checked.
      const session = await manager.findOne(RefreshToken, {
        where: { token_hash: tokenHash },
      });
      if (!session) return refuse('Refresh token not recognized');
      if (session.revoked_at !== null) {
        return {
          ok: false,
          reuse: true,
          error: new UnauthorizedException(
            'Refresh token reuse detected — all sessions revoked',
          ),
        };
      }
      return refuse('Refresh token expired');
    }

    if (claimed.user_id !== userId) {
      return refuse('Refresh token not recognized');
    }

    const freshUser = await this.usersService.findByIdForAuth(userId);
    if (!freshUser || !freshUser.is_active) {
      return refuse('User no longer active');
    }

    const tokens = await this.generateTokens(freshUser);
    await this.persistRefreshToken(
      manager.getRepository(RefreshToken),
      freshUser.id,
      tokens.refresh_token,
      ipAddress,
      userAgent,
    );
    return { ok: true, tokens };
  }

  private async generateTokens(user: User): Promise<TokensDto> {
    const payload = {
      sub: user.id,
      role: user.role,
      branch_id: user.branch_id ?? null, // null for admins, UUID for staff
      jti: crypto.randomUUID(), // unique per token — prevents collision on rapid rotation
    };

    const access_token = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN') as any,
    });

    const refresh_token = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') as any,
    });

    return { access_token, refresh_token };
  }

  private async persistRefreshToken(
    repo: Repository<RefreshToken>,
    userId: string,
    refreshToken: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    const decoded = this.jwtService.decode(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);

    const entity = repo.create({
      user_id: userId,
      token_hash: this.hashToken(refreshToken),
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
    await repo.save(entity);
  }

  private async revokeAllUserSessions(userId: string): Promise<void> {
    await this.refreshTokensRepo.update(
      { user_id: userId, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
