import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { TypedConfigService } from '../../config/typed-config.service';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/enums/user-role.enum';
import { Branch } from '../../branches/entities/branch.entity';

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  branch_id: string | null; // null for admins, UUID for staff
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  branch_id: string | null;
  branch: Branch | null;
}

const ACCESS_TOKEN_COOKIE = 'access_token';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: TypedConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: (req: Request): string | null => {
        return req?.cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
      },
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // findById now eager-loads the branch relation.
    // Fresh DB fetch on every request — the token is trust-but-verify.
    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.is_active) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      branch_id: user.branch_id,
      branch: user.branch ?? null,
    };
  }
}
