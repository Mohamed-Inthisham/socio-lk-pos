import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';

/**
 * Taking a phone in from a customer — a TRADE_IN payment or an outright
 * phone purchase — needs the customer's NIC on file, so a phone that
 * turns out to be stolen can be traced to the person who handed it over
 * (Phase 6.4 P4-13).
 */
export const TRADE_IN_NEEDS_NIC = "A trade-in needs the customer's NIC";
export const PHONE_PURCHASE_NEEDS_NIC =
  "A phone purchase needs the customer's NIC";

/**
 * 400 with `message` unless the customer has an NIC (used by the sale's
 * TRADE_IN checks; PhonePurchasesService.create checks the customer row
 * it already loads). Reads through the
 * caller's manager, so it sees the same snapshot as the rest of the
 * transaction. Soft-deleted customers are included: whether the
 * customer may be used at all is the caller's existing reference check.
 */
export async function assertCustomerHasNic(
  manager: EntityManager,
  customerId: string,
  message: string,
): Promise<void> {
  const customer = await manager.findOne(Customer, {
    where: { id: customerId },
    withDeleted: true,
  });
  if (!customer?.nic) {
    throw new BadRequestException(message);
  }
}
