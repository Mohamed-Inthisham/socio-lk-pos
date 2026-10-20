import { Controller, useWatch } from "react-hook-form";
import { Banknote, Barcode, NotebookPen, Tag } from "lucide-react";
import InputField from "../../common/InputField";
import TradeInProductPicker from "./TradeInProductPicker";
import { LUHN_HINT, RESALE_BELOW_VALUE_HINT } from "./tradeIn";
import { imeiCheckDigitMismatch } from "../../../utils/imei";
import { formatLKR, toCents } from "../../../utils/money";

/**
 * TradeInFields Component
 *
 * TRADE_IN part of the PaymentDialog (planning doc P4-1). Replaces the
 * dialog's Amount field: the Trade-in value is sent as both `amount` and
 * `trade_in_buying_price` (buildPaymentPayload).
 *
 * Order (and Tab order): Product → IMEI → Trade-in value → Resale price
 * → Condition notes. Product spans the width; the other four sit in two
 * columns from `sm`, so the dialog fits a ~640px-tall laptop viewport.
 *
 * - Product: TradeInProductPicker (P4-3). Picking moves on to the IMEI.
 * - IMEI (P4-7): one scanner-friendly input. Enter moves to the trade-in
 *   value instead of submitting, because a scanner sends Enter after
 *   the IMEI. A 15-digit value failing the Luhn check gets a soft
 *   "Check digit doesn't match — rescan?" hint; it never blocks. A
 *   server 409 (`imeiConflict`) shows here, by `existing_unit.status`.
 * - Trade-in value: empty by default (P4-5), capped at the balance due
 *   (P4-4, paymentSchema).
 * - Resale price: optional, > 0; a non-blocking warning when it's below
 *   the trade-in value (P4-6).
 * - Condition notes: optional free text.
 *
 * PROPS:
 * - control, register, errors, setFocus: from the dialog's useForm
 * - branchId: the sale's branch, for the product search
 * - product, onPickProduct: the picked product row (kept by the dialog
 *   so the pending payment row can name it)
 * - balance: balance due ("50000.00"), for the value's hint
 * - imeiConflict: mapped 409 message for the IMEI, or null
 * - onImeiEdit: the IMEI changed (clears a stale 409)
 * - disabled
 */

const MONEY = /^\d+(\.\d{1,2})?$/;

const Warning = ({ children }) => (
  <span className="text-amber-700 dark:text-amber-400">{children}</span>
);

const TradeInFields = ({
  control,
  register,
  errors,
  setFocus,
  branchId,
  product,
  onPickProduct,
  balance,
  imeiConflict = null,
  onImeiEdit,
  disabled,
}) => {
  const [imei, value, resale] = useWatch({
    control,
    name: ["trade_in_imei", "trade_in_buying_price", "trade_in_selling_price"],
  });

  const resaleBelowValue =
    MONEY.test(String(value ?? "").trim()) &&
    MONEY.test(String(resale ?? "").trim()) &&
    toCents(resale.trim()) < toCents(value.trim());

  const handleImeiKeyDown = (event) => {
    if (event.key !== "Enter") return;
    // The dialog skips Enters that were already handled.
    event.preventDefault();
    setFocus("trade_in_buying_price");
  };

  return (
    <div className="space-y-3">
      <Controller
        name="trade_in_product_id"
        control={control}
        render={({ field }) => (
          <TradeInProductPicker
            ref={field.ref}
            name={field.name}
            branchId={branchId}
            product={product}
            onPick={(picked) => {
              onPickProduct(picked);
              field.onChange(picked?.id ?? "");
            }}
            onAdvance={() => setFocus("trade_in_imei")}
            error={errors.trade_in_product_id?.message}
            disabled={disabled}
          />
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <InputField
          label="IMEI"
          required
          icon={Barcode}
          autoComplete="off"
          spellCheck={false}
          placeholder="Scan or type"
          error={errors.trade_in_imei?.message || imeiConflict || undefined}
          hint={imeiCheckDigitMismatch(imei) ? <Warning>{LUHN_HINT}</Warning> : undefined}
          disabled={disabled}
          onKeyDown={handleImeiKeyDown}
          {...register("trade_in_imei", { onChange: onImeiEdit })}
          name="trade_in_imei"
        />

        <InputField
          label="Trade-in value"
          required
          icon={Banknote}
          inputMode="decimal"
          autoComplete="off"
          hint={`Balance due ${formatLKR(balance)}`}
          error={errors.trade_in_buying_price?.message}
          disabled={disabled}
          {...register("trade_in_buying_price")}
          name="trade_in_buying_price"
        />

        <InputField
          label="Resale price"
          icon={Tag}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Optional"
          error={errors.trade_in_selling_price?.message}
          hint={resaleBelowValue ? <Warning>{RESALE_BELOW_VALUE_HINT}</Warning> : undefined}
          disabled={disabled}
          {...register("trade_in_selling_price")}
          name="trade_in_selling_price"
        />

        <InputField
          label="Condition notes"
          icon={NotebookPen}
          autoComplete="off"
          placeholder="e.g. Screen scratch, battery 89%"
          error={errors.trade_in_notes?.message}
          disabled={disabled}
          {...register("trade_in_notes")}
          name="trade_in_notes"
        />
      </div>
    </div>
  );
};

export default TradeInFields;
