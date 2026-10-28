import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import usePermissions from "../../hooks/usePermissions";
import { listSuppliers } from "../../services/suppliersService";
import { listProducts } from "../../services/productsService";
import { createStockPurchase } from "../../services/stockPurchasesService";
import { fetchBranches, selectActiveBranches, selectBranchesInitialized } from "../../store/slices/branchesSlice";
import { formatLKR } from "../../utils/money";
import SupplierFormDialog from "../Suppliers/SupplierFormDialog";
import ProductCreate from "../ProductCreate";

const panel = "rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900";
const moneyPattern = /^\d{1,8}(\.\d{1,2})?$/;
const paymentMoneyPattern = /^\d{1,12}(\.\d{1,2})?$/;
const parseIdentifierRows = (value) => {
  const rows = value ? value.split(/\r?\n/).map((part) => part.trim()) : [];
  while (rows.at(-1) === "") rows.pop();
  return rows;
};
const trackingMethodFor = (product) => product?.tracking_method ?? (product?.is_serialized ? "IMEI" : "QUANTITY");
const currentColomboDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const newItem = () => ({ product_id: "", quantity: "1", unit_buying_price: "", unit_selling_price: "", imeiIdentifiers: "", serialIdentifiers: "" });
const paymentMethods = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "ONLINE_TRANSFER", label: "Online transfer" },
  { value: "CHEQUE", label: "Cheque" },
];

export default function StockPurchaseCreate() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const purchaseDraft = location.state?.stockPurchaseDraft;
  const { isAdmin, isManager } = usePermissions();
  const user = useSelector((state) => state.auth.user);
  const branches = useSelector(selectActiveBranches);
  const branchesInitialized = useSelector(selectBranchesInitialized);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState(purchaseDraft?.supplierId || "");
  const [branchId, setBranchId] = useState(purchaseDraft?.branchId || user?.branch_id || "");
  const [purchaseDate, setPurchaseDate] = useState(purchaseDraft?.purchaseDate || currentColomboDate);
  const [paymentMode, setPaymentMode] = useState("CREDIT");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(currentColomboDate);
  const [paymentReference, setPaymentReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [bank, setBank] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(purchaseDraft?.invoiceNumber || "");
  const [notes, setNotes] = useState(purchaseDraft?.notes || "");
  const [items, setItems] = useState(() =>
    purchaseDraft?.items?.length
      ? purchaseDraft.items.map((item) => ({
          ...newItem(),
          ...item,
          imeiIdentifiers: item.imeiIdentifiers ?? item.identifiers ?? "",
          serialIdentifiers: item.serialIdentifiers ?? "",
        }))
      : [newItem()],
  );
  const [createdProduct, setCreatedProduct] = useState(location.state?.createdProduct || null);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    if (!branchesInitialized) dispatch(fetchBranches());
  }, [dispatch, branchesInitialized]);

  useEffect(() => {
    let live = true;
    Promise.all([listSuppliers(), listProducts({ limit: 200 })])
      .then(([supplierRows, productResult]) => {
        if (!live) return;
        setSuppliers(supplierRows.filter((supplier) => supplier.is_active));
        setProducts(productResult.data.filter((product) => product.is_active));
      })
      .catch((error) => {
        if (live) setPageError(error.response?.data?.message || "Couldn't load suppliers and products.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!createdProduct) return;
    setProducts((current) => current.some((product) => product.id === createdProduct.id)
      ? current
      : [...current, createdProduct]);
    setItems((current) => {
      if (current.some((item) => item.product_id === createdProduct.id)) return current;
      const emptyIndex = current.findIndex((item) => !item.product_id);
      if (emptyIndex >= 0) {
        return current.map((item, index) => index === emptyIndex
          ? { ...item, product_id: createdProduct.id, unit_selling_price: createdProduct.selling_price ?? "" }
          : item);
      }
      return [...current, { ...newItem(), product_id: createdProduct.id, unit_selling_price: createdProduct.selling_price ?? "" }];
    });
    setCreatedProduct(null);
  }, [createdProduct]);

  useEffect(() => {
    if (isManager && user?.branch_id) setBranchId(user.branch_id);
  }, [isManager, user?.branch_id]);

  const supplierOptions = useMemo(() => [
    { value: "", label: "Select a supplier" },
    ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
  ], [suppliers]);
  const branchOptions = useMemo(() => [
    { value: "", label: "Select a branch" },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ], [branches]);
  const selectedProducts = new Set(items.map((item) => item.product_id).filter(Boolean));
  const productOptionsFor = (currentId) => [
    { value: "", label: "Select a product" },
    ...products
      .filter((product) => product.id === currentId || !selectedProducts.has(product.id))
      .map((product) => ({ value: product.id, label: `${product.name} · ${product.sku}` })),
  ];

  const totalCents = items.reduce((sum, item) => {
    const quantity = Number(item.quantity);
    const price = Number(item.unit_buying_price);
    return Number.isInteger(quantity) && quantity > 0 && Number.isFinite(price)
      ? sum + Math.round(price * 100) * quantity
      : sum;
  }, 0);

  const updateItem = (index, key, value) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
    setFieldError("");
  };
  const selectProduct = (index, productId) => {
    const product = products.find((candidate) => candidate.id === productId);
    setItems((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, product_id: productId, unit_selling_price: product?.selling_price ?? "", imeiIdentifiers: "", serialIdentifiers: "" }
      : item));
    setFieldError("");
  };

  const openProductCreate = () => {
    setProductFormOpen(true);
  };

  const validate = () => {
    if (!supplierId) return "Select a supplier.";
    if (!branchId) return "Select a branch.";
    if (!purchaseDate) return "Enter the purchase date.";
    if (paymentMode !== "CREDIT") {
      const paidCents = paymentMode === "FULL"
        ? totalCents
        : paymentMoneyPattern.test(paymentAmount)
          ? Math.round(Number(paymentAmount) * 100)
          : 0;
      if (!paymentDate) return "Enter the payment date.";
      if (!paidCents) return paymentMode === "FULL" ? "Add products and prices before recording full payment." : "Enter a valid payment amount.";
      if (paidCents > totalCents) return "Payment cannot exceed the purchase total.";
      if (paymentMode === "PARTIAL" && !paymentMoneyPattern.test(paymentAmount)) return "Enter a valid payment amount.";
      if (paymentMethod === "CHEQUE" && (!chequeNumber.trim() || !chequeDate || !bank.trim())) {
        return "Enter the cheque number, cheque date, and bank.";
      }
    }
    if (!items.length) return "Add at least one product.";
    for (const [index, item] of items.entries()) {
      const product = products.find((candidate) => candidate.id === item.product_id);
      if (!product) return `Select a product for item ${index + 1}.`;
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) return `Enter a valid quantity for ${product.name}.`;
      if (!moneyPattern.test(item.unit_buying_price)) return `Enter a valid buying price for ${product.name}.`;
      if (item.unit_selling_price && !moneyPattern.test(item.unit_selling_price)) return `Enter a valid selling price for ${product.name}, or leave it blank.`;
      const imeiRows = parseIdentifierRows(item.imeiIdentifiers);
      const serialRows = parseIdentifierRows(item.serialIdentifiers);
      const imeis = imeiRows.filter(Boolean);
      const serials = serialRows.filter(Boolean);
      const trackingMethod = trackingMethodFor(product);
      if (trackingMethod === "IMEI" && imeis.length !== quantity) return `Enter one IMEI for each of the ${quantity} ${product.name} units.`;
      if (Math.max(imeiRows.length, serialRows.length) > quantity) return `There are more identifiers than ${product.name} units.`;
      if (trackingMethod === "QUANTITY" && (imeis.length || serials.length)) return `${product.name} is set to have no per-unit identifiers.`;
      if (Math.max(imeis.length, serials.length) > 200) return `Enter no more than 200 identifiers for ${product.name} in one purchase.`;
      const allIdentifiers = [...imeis, ...serials];
      if (new Set(allIdentifiers).size !== allIdentifiers.length) return `Remove duplicate identifiers from ${product.name}.`;
      if (imeis.some((identifier) => !/^[A-Za-z0-9-]{8,100}$/.test(identifier))) return `Check the IMEI entries for ${product.name}.`;
      if (serials.some((identifier) => !/^[A-Za-z0-9-]{1,100}$/.test(identifier))) return `Check the serial number entries for ${product.name}.`;
    }
    return "";
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setPageError("");
    const validationMessage = validate();
    if (validationMessage) {
      setFieldError(validationMessage);
      return;
    }
    const payload = {
      supplier_id: supplierId,
      branch_id: branchId,
      purchase_date: purchaseDate,
      ...(invoiceNumber.trim() && { supplier_invoice_number: invoiceNumber.trim() }),
      ...(notes.trim() && { notes: notes.trim() }),
      ...(paymentMode !== "CREDIT" && {
        initial_payment: {
          amount: paymentMode === "FULL" ? (totalCents / 100).toFixed(2) : paymentAmount,
          method: paymentMethod,
          payment_date: paymentDate,
          ...(paymentReference.trim() && { reference: paymentReference.trim() }),
          ...(paymentMethod === "CHEQUE" && {
            cheque_number: chequeNumber.trim(),
            cheque_date: chequeDate,
            bank: bank.trim(),
          }),
        },
      }),
      items: items.map((item) => {
        const product = products.find((candidate) => candidate.id === item.product_id);
        const imeiRows = parseIdentifierRows(item.imeiIdentifiers);
        const serialRows = parseIdentifierRows(item.serialIdentifiers);
        const unitIdentifiers = Array.from(
          { length: Math.max(imeiRows.length, serialRows.length) },
          (_, index) => ({
            ...(imeiRows[index] && { imei_number: imeiRows[index] }),
            ...(serialRows[index] && { serial_number: serialRows[index] }),
          }),
        ).filter((pair) => pair.imei_number || pair.serial_number);
        return {
          product_id: item.product_id,
          quantity: Number(item.quantity),
          unit_buying_price: item.unit_buying_price,
          ...(item.unit_selling_price && { unit_selling_price: item.unit_selling_price }),
          ...(unitIdentifiers.length && { unit_identifiers: unitIdentifiers }),
        };
      }),
    };
    setIsSubmitting(true);
    try {
      const purchase = await createStockPurchase(payload);
      navigate(`/stock-purchases/${purchase.id}`, { replace: true });
    } catch (error) {
      setPageError(error.response?.data?.message || error.message || "Couldn't save this stock purchase.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <button type="button" onClick={() => navigate("/stock-purchases")} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ArrowLeft size={15} /> Stock purchases
      </button>
      <header>
        <h1 className="text-2xl font-semibold">New stock purchase</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Receiving this purchase immediately increases stock at the selected branch.</p>
      </header>

      {pageError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{pageError}</div>}
      <SupplierFormDialog
        open={supplierFormOpen}
        supplier={null}
        onClose={() => setSupplierFormOpen(false)}
        onSaved={(supplier) => {
          setSuppliers((current) => [...current.filter((row) => row.id !== supplier.id), supplier]);
          setSupplierId(supplier.id);
        }}
      />
      {productFormOpen && isAdmin && (
        <ProductCreate
          embedded
          onCreated={(product) => {
            setCreatedProduct(product);
            setProductFormOpen(false);
          }}
          onCancel={() => setProductFormOpen(false)}
        />
      )}
      {loading ? (
        <div className={`${panel} text-sm text-slate-500`}>Loading suppliers and products…</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <section className={`${panel} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Purchase details</h2>
                <p className="mt-1 text-xs text-slate-500">Supplier invoice details are for reference.</p>
              </div>
              {isAdmin && <Button type="button" variant="secondary" icon={Plus} label="Add new supplier" onClick={() => setSupplierFormOpen(true)} />}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Supplier" required name="supplier_id" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} options={supplierOptions} />
              {isAdmin ? (
                <Select label="Receiving branch" required name="branch_id" value={branchId} onChange={(event) => setBranchId(event.target.value)} options={branchOptions} />
              ) : (
                <InputField label="Receiving branch" value={branches.find((branch) => branch.id === branchId)?.name || "Assigned branch"} readOnly />
              )}
              <InputField label="Purchase date" type="date" required value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} />
              <InputField label="Supplier invoice number" placeholder="Optional" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
            </div>
          </section>

          <section className={`${panel} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Products received</h2>
                <p className="mt-1 text-xs text-slate-500">Buying price is recorded per purchase. Selling price may be updated here or later.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isAdmin && <Button type="button" variant="secondary" icon={Plus} label="Add new product" onClick={openProductCreate} />}
              </div>
            </div>

            {items.map((item, index) => {
              const product = products.find((candidate) => candidate.id === item.product_id);
              const imeiCount = parseIdentifierRows(item.imeiIdentifiers).filter(Boolean).length;
              const serialCount = parseIdentifierRows(item.serialIdentifiers).filter(Boolean).length;
              const trackingMethod = trackingMethodFor(product);
              return (
                <article key={`line-${index}`} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold">Product {index + 1}</h3>
                    {items.length > 1 && <button type="button" aria-label={`Remove product ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Trash2 size={16} /></button>}
                  </div>
                  <Select label="Product" required name={`product-${index}`} value={item.product_id} onChange={(event) => selectProduct(index, event.target.value)} options={productOptionsFor(item.product_id)} />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <InputField label="Quantity received" type="number" required min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} />
                    <InputField label="Unit buying price" required inputMode="decimal" placeholder="e.g. 18000.00" value={item.unit_buying_price} onChange={(event) => updateItem(index, "unit_buying_price", event.target.value)} />
                    <InputField label="Selling price" inputMode="decimal" placeholder="Optional" value={item.unit_selling_price} onChange={(event) => updateItem(index, "unit_selling_price", event.target.value)} />
                  </div>
                  {product && trackingMethod !== "QUANTITY" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <InputField
                        type="textarea"
                        label={`IMEI numbers (${imeiCount}${trackingMethod === "IMEI" ? `/${item.quantity || 0}` : " optional"})`}
                        required={trackingMethod === "IMEI"}
                        rows={Math.min(5, Math.max(2, imeiCount + 1))}
                        placeholder="One IMEI per unit, one per line"
                        value={item.imeiIdentifiers}
                        onChange={(event) => updateItem(index, "imeiIdentifiers", event.target.value)}
                        hint={trackingMethod === "IMEI" ? "Enter exactly one IMEI per received unit. Serial numbers below are paired by line." : "Optional. Enter an IMEI when the unit has one; pair it with its serial on the same line."}
                      />
                      <InputField
                        type="textarea"
                        label={`Serial numbers (${serialCount} optional)`}
                        rows={Math.min(5, Math.max(2, serialCount + 1))}
                        placeholder="Optional: one serial number per unit, one per line"
                        value={item.serialIdentifiers}
                        onChange={(event) => updateItem(index, "serialIdentifiers", event.target.value)}
                        hint="Keep the same line order as the IMEI list. Leave a blank line when a unit has no serial number."
                      />
                    </div>
                  )}
                  <div className="text-right text-sm text-slate-600 dark:text-slate-300">Line total: <span className="font-semibold tabular-nums">{formatLKR((Math.max(0, Number(item.quantity) || 0) * (Number(item.unit_buying_price) || 0)).toFixed(2))}</span></div>
                </article>
              );
            })}
            <button
              type="button"
              onClick={() => setItems((current) => [...current, newItem()])}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600 transition hover:border-cyan-500 hover:text-cyan-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-cyan-300"
            >
              <Plus size={16} /> Add another product
            </button>
            {fieldError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{fieldError}</p>}
            {products.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Create a product before recording its stock purchase.</p>}
            <div className="flex justify-end border-t border-slate-200 pt-4 text-right dark:border-slate-700">
              <div><p className="text-xs uppercase tracking-wide text-slate-500">Purchase total</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatLKR((totalCents / 100).toFixed(2))}</p></div>
            </div>
          </section>

          <section className={panel}>
            <InputField type="textarea" label="Notes" rows={3} maxLength={2000} placeholder="Optional notes about this purchase" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </section>

          <section className={`${panel} space-y-4`}>
            <div>
              <h2 className="font-semibold">Supplier payment</h2>
              <p className="mt-1 text-xs text-slate-500">Choose credit to pay later, or record a full or partial payment now.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Payment"
                value={paymentMode}
                onChange={(event) => setPaymentMode(event.target.value)}
                options={[
                  { value: "CREDIT", label: "Credit (pay later)" },
                  { value: "FULL", label: "Paid in full" },
                  { value: "PARTIAL", label: "Partial payment" },
                ]}
              />
              {paymentMode !== "CREDIT" && (
                <Select label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} options={paymentMethods} />
              )}
              {paymentMode === "PARTIAL" && (
                <InputField label="Amount paid" required inputMode="decimal" placeholder="e.g. 25000.00" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              )}
              {paymentMode === "FULL" && (
                <InputField label="Amount paid" value={(totalCents / 100).toFixed(2)} readOnly />
              )}
              {paymentMode !== "CREDIT" && (
                <InputField label="Payment date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              )}
              {paymentMode !== "CREDIT" && paymentMethod !== "CHEQUE" && (
                <InputField label="Payment reference" placeholder="Optional" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
              )}
              {paymentMode !== "CREDIT" && paymentMethod === "CHEQUE" && <>
                <InputField label="Cheque number" required value={chequeNumber} onChange={(event) => setChequeNumber(event.target.value)} />
                <InputField label="Cheque date" type="date" required value={chequeDate} onChange={(event) => setChequeDate(event.target.value)} />
                <InputField label="Bank" required value={bank} onChange={(event) => setBank(event.target.value)} />
                <p className="sm:col-span-2 text-xs text-amber-700 dark:text-amber-300">This cheque will remain pending and the amount due will only decrease after it clears.</p>
              </>}
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" label="Cancel" disabled={isSubmitting} onClick={() => navigate("/stock-purchases")} />
            <Button type="submit" label={isSubmitting ? "Receiving stock…" : "Record purchase and receive stock"} disabled={isSubmitting || products.length === 0} />
          </div>
        </form>
      )}
    </div>
  );
}
