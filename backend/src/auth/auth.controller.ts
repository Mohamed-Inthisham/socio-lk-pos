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
  UseGuards,
} from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import { TypedConfigService } from '../config/typed-config.service';

const ACCESS_TOKEN_COOKIE = 'access_token';
const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_PATH = '/api/v1/auth/refresh';

// Rough milliseconds — used for cookie maxAge only. Actual token expiry is
// enforced by JWT signature, so cookie maxAge is a hint to the browser.
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: TypedConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
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

    return {
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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

  @Post('logout')
  @HttpCode(HttpStatus.OK)
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
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser | undefined) {
    // JwtAuthGuard guarantees user is present, but the type reflects the
    // decorator's honest signature. Assert here for the response.
    if (!user) throw new UnauthorizedException();
    return { user };
  }

  // ---------- private helpers ----------

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
