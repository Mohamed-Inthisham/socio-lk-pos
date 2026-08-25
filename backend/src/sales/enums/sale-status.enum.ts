/**
 * The lifecycle status of a Sale.
 *
 * DRAFT     — cart being built; no stock impact, no invoice number yet
 * COMPLETED — payment taken, stock decremented, invoice number issued
 * VOIDED    — was COMPLETED, now reversed; stock re-incremented,
 *             payments marked reversed. Record stays in ledger forever.
 *
 * Transitions:
 *   DRAFT     → COMPLETED (via /sales/:id/complete)
 *   COMPLETED → VOIDED    (via /sales/:id/void)
 *   DRAFT     → deleted   (via DELETE /sales/:id)
 *
 * No other transitions are valid. In particular:
 *   - VOIDED is terminal (no un-void; add a new Sale instead)
 *   - COMPLETED cannot go back to DRAFT
 */
export enum SaleStatus {
  DRAFT = 'DRAFT',
  COMPLETED = 'COMPLETED',
  VOIDED = 'VOIDED',
}
