import { AuthenticatedUser } from '../strategies/jwt.strategy';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
