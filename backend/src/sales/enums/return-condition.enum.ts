/**
 * The cashier's choice for a returned non-phone item from our stock with
 * stock tracking (Phase 6.4 P7-8): RESALEABLE goes back to stock
 * (disposition RESTOCKED), DAMAGED doesn't (disposition DAMAGED). Phones,
 * other shops' lines and untracked products take no condition.
 */
export enum ReturnCondition {
  RESALEABLE = 'RESALEABLE',
  DAMAGED = 'DAMAGED',
}
