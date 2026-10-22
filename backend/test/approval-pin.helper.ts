import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';

/**
 * Manager approval PIN for e2e specs (Phase 6.4 P6-17): every void needs
 * one. Specs give their admins and managers this PIN when seeding them and
 * send approvalFor(<approver id>) with each void.
 */
export const TEST_PIN = '482916';

let pinHash: string | undefined;

/** Store TEST_PIN (bcrypt, cost 4 like the specs' passwords) on a user. */
export async function giveApprovalPin(
  dataSource: DataSource,
  userId: string,
): Promise<void> {
  pinHash ??= await bcrypt.hash(TEST_PIN, 4);
  await dataSource.getRepository(User).update(userId, {
    approval_pin_hash: pinHash,
    approval_pin_set_at: new Date(),
  });
}

/** The `approval` body of a void approved by `approverId` with TEST_PIN. */
export const approvalFor = (approverId: string, pin = TEST_PIN) => ({
  approver_id: approverId,
  pin,
});
