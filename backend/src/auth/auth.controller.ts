import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
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
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { TypedConfigService } from '../config/typed-config.service';
import { Public } from './decorators/public.decorator';
import { UsersService } from '../users/users.service';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_PATH = '/api/v1/auth/refresh';

const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: TypedConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Validates credentials, sets httpOnly access and refresh cookies, and returns the user profile.',
  })
  @ApiResponse({ status: 200, description: 'Login successful — cookies set' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
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
      this.extractIp(req),
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
      this.extractIp(req),
      this.extractUserAgent(req),
    );

    this.setAccessCookie(res, access_token);
    this.setRefreshCookie(res, refresh_token);

    return { success: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log out and clear session cookies',
    description:
      'Revokes the current refresh token (if present) and clears both access and refresh cookies.',
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

  private extractIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.ip ?? null;
  }

  private extractUserAgent(req: Request): string | null {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua.slice(0, 500) : null;
  }
}
