import { AuthenticatedUser } from '../strategies/jwt.strategy';

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}

export {};
