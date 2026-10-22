import { Ban } from "lucide-react";
import { receiptDateTime } from "../../../utils/receipt";

/**
 * VoidedSaleBanner Component
 *
 * The red banner on a VOIDED sale's detail page (P6-6): when it was voided,
 * why, who approved it (`voider`, the manager or admin whose PIN it was)
 * and, when that was someone else, whose session asked for it
 * (`void_requester`, P6-17).
 *
 * PROPS:
 * - sale: the hydrated VOIDED sale (GET /sales/:id)
 */

const VoidedSaleBanner = ({ sale }) => {
  const requestedBySomeoneElse =
    sale.void_requester && sale.void_requested_by && sale.void_requested_by !== sale.voided_by;

  return (
    <section
      aria-label="Voided"
      className="flex gap-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
    >
      <Ban size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">
          Voided {receiptDateTime(sale.voided_at)}
          {sale.void_reason && <span className="font-normal"> — {sale.void_reason}</span>}
        </p>
        <p className="mt-0.5 text-red-700 dark:text-red-300">
          Approved by {sale.voider?.full_name ?? "—"}
          {requestedBySomeoneElse && ` · requested on ${sale.void_requester.full_name}'s session`}
        </p>
      </div>
    </section>
  );
};

export default VoidedSaleBanner;
