import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokensDto } from './dto/tokens.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { TypedConfigService } from '../config/typed-config.service';
import { Public } from './decorators/public.decorator';
import { LoginThrottle } from '../config/throttle';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from '../users/dto/change-password.dto';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_PATH = '/api/v1/auth/refresh';

const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: TypedConfigService,
  ) {}

  @Public()
  @LoginThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Validates credentials, sets httpOnly access and refresh cookies, and returns the user profile.',
  })
  @ApiResponse({ status: 200, description: 'Login successful — cookies set' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({
    status: 429,
    description: 'Too many login attempts from this IP (LOGIN_THROTTLE_*)',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { access_token, refresh_token } = await this.authService.login(
      user,
      req.ip ?? null, // trusted proxies only (TRUST_PROXY)
      this.extractUserAgent(req),
    );

    this.setAccessCookie(res, access_token);
    this.setRefreshCookie(res, refresh_token);

    // Re-fetch with branch relation loaded, so login response mirrors /auth/me.
    const enriched = await this.usersService.findById(user.id);
    if (!enriched) {
      // Should never happen — user just authenticated seconds ago.
      throw new UnauthorizedException();
    }

    return {
      user: {
        id: enriched.id,
        email: enriched.email,
        full_name: enriched.full_name,
        role: enriched.role,
        branch_id: enriched.branch_id,
        branch: enriched.branch ?? null,
        // From the database, as /auth/me (P6-15); never the JWT.
        has_approval_pin: enriched.approval_pin_set_at !== null,
        approval_pin_set_at: enriched.approval_pin_set_at,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate access and refresh tokens',
    description:
      'Reads the refresh_token cookie, rotates it, and issues a new access_token. Detects reuse of revoked tokens.',
  })
  @ApiResponse({ status: 200, description: 'Tokens rotated successfully' })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid, or revoked refresh token',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException('No refresh token');
    }

    const { access_token, refresh_token } = await this.authService.refresh(
      token,
      req.ip ?? null, // trusted proxies only (TRUST_PROXY)
      this.extractUserAgent(req),
    );

    this.setAccessCookie(res, access_token);
    this.setRefreshCookie(res, refresh_token);

    return { success: true };
  }

  @Public()
  @Post(['refresh/logout', 'logout'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out and clear session cookies',
    description:
      'Revokes the current refresh token (if present) and clears both cookies. ' +
      'Browser clients must use /auth/refresh/logout to send the narrowly scoped ' +
      'refresh cookie. /auth/logout remains a compatibility alias but browsers ' +
      'do not send the refresh cookie to that path.',
  })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (token) {
      await this.authService.logout(token);
    }

    this.clearCookie(res, ACCESS_TOKEN_COOKIE);
    this.clearCookie(res, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_PATH);

    return { success: true };
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Get current authenticated user',
    description:
      'Returns the user derived from the access_token cookie. Fresh-fetched from the DB each call.',
  })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  getMe(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return { user };
  }

  @Put('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Any signed-in user. Needs your current password; the new one is at ' +
      'least 8 characters, at most 72 bytes in UTF-8, and different from ' +
      'the current one. Revokes every refresh token of yours (other ' +
      'devices must log in again once their access token expires) and ' +
      'sets fresh session cookies for this one. Writes a PASSWORD_CHANGED ' +
      'audit entry (never a password).',
  })
  @ApiResponse({ status: 204, description: 'Password changed, cookies set' })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, or { message, code: SAME_PASSWORD } for an unchanged password',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({
    status: 403,
    description: 'Current password wrong ({ message, code: WRONG_PASSWORD })',
  })
  @ApiResponse({
    status: 503,
    description:
      'Password changed, but no new session could be started: no cookies ' +
      'set, log in again ({ message, code: PASSWORD_CHANGED_SIGN_IN_AGAIN })',
  })
  async changeOwnPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.changeOwnPassword(user, dto, req.ip ?? null);

    // The change revoked every refresh token, this device's too (its
    // refresh cookie isn't sent here: it's scoped to /auth/refresh). Keep
    // this device signed in with a new pair, as login does.
    let tokens: TokensDto | undefined;
    try {
      const fresh = await this.usersService.findByIdForAuth(user.id);
      if (fresh?.is_active) {
        tokens = await this.authService.login(
          fresh,
          req.ip ?? null,
          this.extractUserAgent(req),
        );
      }
    } catch (error) {
      // The password change is committed and stays: say so, so the client
      // sends the user to log in instead of retrying with the old password.
      // Only the error's name and message are logged, never a token.
      const reason =
        error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
      this.logger.error(
        `New session not issued after user ${user.id} changed their password (${reason})`,
      );
      throw new ServiceUnavailableException({
        message: 'Your password was changed. Please sign in again.',
        code: 'PASSWORD_CHANGED_SIGN_IN_AGAIN',
      });
    }
    if (!tokens) {
      // Deactivated or deleted meanwhile: no new session.
      throw new UnauthorizedException();
    }
    this.setAccessCookie(res, tokens.access_token);
    this.setRefreshCookie(res, tokens.refresh_token);
  }

  // ---------- private helpers (unchanged) ----------

  private setAccessCookie(res: Response, token: string): void {
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.baseCookieOptions(),
      maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    });
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      ...this.baseCookieOptions(),
      path: REFRESH_TOKEN_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearCookie(res: Response, name: string, path?: string): void {
    res.clearCookie(name, {
      ...this.baseCookieOptions(),
      ...(path ? { path } : {}),
    });
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'strict',
      domain: this.config.get('COOKIE_DOMAIN'),
    };
  }

  private extractUserAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua.slice(0, 500) : null;
  }
}
