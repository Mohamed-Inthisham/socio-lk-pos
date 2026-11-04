import {
  ClassSerializerContextOptions,
  ClassSerializerInterceptor,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { UserRole } from '../../users/enums/user-role.enum';
import { canViewCost, COST_GROUP } from '../utils/cost-visibility';

/**
 * The global serializer: ClassSerializerInterceptor, plus COST_GROUP for a
 * user who may see cost prices (INV-F3). Guards run first, so request.user
 * is the session user; without one no group is added and cost stays hidden.
 */
@Injectable()
export class RoleAwareSerializerInterceptor extends ClassSerializerInterceptor {
  protected getContextOptions(
    context: ExecutionContext,
  ): ClassSerializerContextOptions | undefined {
    const options = super.getContextOptions(context);
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();
    if (!canViewCost(user)) return options;
    return { ...options, groups: [...(options?.groups ?? []), COST_GROUP] };
  }
}
