import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UsersService } from '../users/users.service';
import { TypedConfigService } from '../config/typed-config.service';
import { TokensDto } from './dto/tokens.dto';

const DUMMY_HASH =
  '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV.';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: TypedConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepo: Repository<RefreshToken>,
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

    const tokenHash = this.hashToken(refreshToken);
    const session = await this.refreshTokensRepo.findOne({
      where: { token_hash: tokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Refresh token not recognized');
    }

    if (session.revoked_at !== null) {
      await this.revokeAllUserSessions(payload.sub);
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions revoked',
      );
    }

    if (session.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    session.revoked_at = new Date();
    await this.refreshTokensRepo.save(session);

    const freshUser = await this.usersService.findByIdWithHash(payload.sub);
    if (!freshUser || !freshUser.is_active) {
      throw new UnauthorizedException('User no longer active');
    }

    const newTokens = await this.generateTokens(freshUser);
    await this.persistRefreshToken(
      freshUser.id,
      newTokens.refresh_token,
      ipAddress,
      userAgent,
    );

    return newTokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokensRepo.update(
      { token_hash: tokenHash, revoked_at: IsNull() },
      { revoked_at: new Date() },
    );
  }

  // ---------- private helpers ----------

  private async generateTokens(user: User): Promise<TokensDto> {
    const payload = { sub: user.id, role: user.role };

    const access_token = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      // Cast: Zod validates format at startup; @nestjs/jwt's StringValue
      // template literal type doesn't accept env-sourced strings.
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN') as any,
    });

    const refresh_token = await this.jwtService.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') as any,
    });

    return { access_token, refresh_token };
  }

  private async persistRefreshToken(
    userId: string,
    refreshToken: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    const decoded = this.jwtService.decode(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);

    const entity = this.refreshTokensRepo.create({
      user_id: userId,
      token_hash: this.hashToken(refreshToken),
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
    await this.refreshTokensRepo.save(entity);
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
