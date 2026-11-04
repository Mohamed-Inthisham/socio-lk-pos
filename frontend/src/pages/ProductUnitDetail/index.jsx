import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Smartphone } from "lucide-react";
import Button from "../../components/common/Button";
import Section, { Field } from "../../components/common/DetailSection";
import Table from "../../components/common/Table";
import UnitStatusBadge from "../../components/inventory/UnitStatusBadge";
import SaleStatusBadge from "../../components/pos/SaleStatusBadge";
import { getProductUnitDetails } from "../../services/productUnitsService";
import { receiptDate, receiptDateTime } from "../../utils/receipt";
import { unitIdentifiers } from "../../utils/unitIdentifiers";

/**
 * ProductUnitDetail Page
 *
 * Route: /inventory/units/:id, admins and managers only. One physical unit
 * (GET /product-units/:id/details): what it is, how it was acquired, its
 * sales and its returns. Read-only.
 *
 * The API carries no prices, customer contact details or free text, and this
 * page shows only the fields it names, so nothing else can appear. Customer
 * and supplier names stay plain text: a customer link would lead to their
 * contact details.
 *
 * NOT FOUND covers a missing id, a malformed one (400) and, for a manager, a
 * unit at another branch (the backend's same 404), so the page can't reveal
 * that one exists.
 *
 * BACK: the list passes its search in location.state.from, and a unit opened
 * directly goes back to the plain list. Sale links pass this page and that
 * state on, so Back from the sale restores both.
 */

const TRACKING_LABELS = { IMEI: "IMEI", SERIAL_NUMBER: "Serial number" };
const DISPOSITION_LABELS = { INSPECTION: "For inspection" };
const linkClass = "text-cyan-700 underline dark:text-cyan-300";

const Loading = () => (
  <div className="animate-pulse space-y-4" role="status" aria-label="Loading unit">
    <div className="h-8 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
    <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="h-56 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900" />
      <div className="h-56 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900" />
    </div>
  </div>
);

const Message = ({ icon: Icon, title, children, action }) => (
  <div className="flex flex-col items-center justify-center py-24 text-center">
    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
      <Icon size={28} className="text-slate-400 dark:text-slate-500" />
    </div>
    <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
    <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</p>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

const Acquisition = ({ acquisition, saleState }) => {
  if (acquisition.type === "STOCK_PURCHASE") {
    return (
      <>
        <Field label="Type" value="Stock purchase" />
        <Field
          label="Purchase"
          value={
            <Link to={`/stock-purchases/${acquisition.stock_purchase.id}`} className={linkClass}>
              {acquisition.stock_purchase.purchase_number}
            </Link>
          }
        />
        <Field label="Date" value={receiptDate(acquisition.date)} />
        <Field label="Supplier" value={acquisition.supplier_name} />
      </>
    );
  }
  if (acquisition.type === "PHONE_PURCHASE") {
    return (
      <>
        <Field label="Type" value="Bought from customer" />
        <Field label="Date" value={receiptDateTime(acquisition.date)} />
        <Field label="Seller" value={acquisition.customer_name} />
      </>
    );
  }
  if (acquisition.type === "TRADE_IN") {
    return (
      <>
        <Field label="Type" value="Trade-in" />
        <Field label="Date" value={receiptDateTime(acquisition.date)} />
        <Field label="Customer" value={acquisition.customer_name} />
        <Field
          label="Sale"
          value={
            <Link to={`/sales/history/${acquisition.sale.id}`} state={saleState} className={linkClass}>
              {acquisition.sale.sale_number}
            </Link>
          }
        />
      </>
    );
  }
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      No acquisition record is available for this unit.
    </p>
  );
};

const Details = ({ details, saleState }) => {
  const { unit, product, branch, acquisition, sales, returns } = details;
  const { imei, serial } = unitIdentifiers(unit, product.tracking_method);

  const saleColumns = [
    {
      key: "sale",
      header: "Sale",
      primary: true,
      render: (sale) => (
        <Link to={`/sales/history/${sale.id}`} state={saleState} className={linkClass}>
          {sale.sale_number}
          {sale.status === "VOIDED" ? " (voided)" : ""}
        </Link>
      ),
    },
    { key: "status", header: "Status", render: (sale) => <SaleStatusBadge state={sale.status} /> },
    {
      key: "date",
      header: "Date",
      render: (sale) => receiptDateTime(sale.status === "VOIDED" ? sale.voided_at : sale.completed_at),
    },
    { key: "customer", header: "Customer", render: (sale) => sale.customer_name ?? "Walk-in" },
  ];
  const returnColumns = [
    { key: "return", header: "Return", primary: true, render: (ret) => ret.return_number },
    {
      key: "sale",
      header: "Sale",
      render: (ret) => (
        <Link
          to={`/sales/history/${ret.sale_id}`}
          state={{ ...saleState, tab: "returns" }}
          className={linkClass}
        >
          {ret.sale_number}
        </Link>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (ret) => DISPOSITION_LABELS[ret.disposition] ?? ret.disposition,
    },
    { key: "date", header: "Date", render: (ret) => receiptDateTime(ret.returned_at) },
  ];

  return (
    <div className="space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{product.name}</h1>
          <UnitStatusBadge status={unit.status} />
        </div>
        <p className="mt-1 font-mono text-sm text-slate-500 dark:text-slate-400">{imei ?? serial}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Unit">
          <Field label="IMEI" value={imei} mono />
          <Field label="Serial number" value={serial} mono />
          <Field label="Status" value={<UnitStatusBadge status={unit.status} />} />
          <Field label="Branch" value={branch.name} />
          <Field label="Date added" value={receiptDateTime(unit.created_at)} />
        </Section>

        <Section title="Product">
          <Field
            label="Name"
            value={
              <Link to={`/products/${product.id}`} className={linkClass}>
                {product.name}
              </Link>
            }
          />
          <Field label="SKU" value={product.sku} mono />
          <Field label="Tracking" value={TRACKING_LABELS[product.tracking_method] ?? product.tracking_method} />
        </Section>
      </div>

      <Section title="Acquisition">
        <Acquisition acquisition={acquisition} saleState={saleState} />
      </Section>

      <Section title="Sales history">
        <Table columns={saleColumns} data={sales} ariaLabel="Sales history" emptyMessage="This unit hasn't been sold." dense />
      </Section>

      <Section title="Return history">
        <Table columns={returnColumns} data={returns} ariaLabel="Return history" emptyMessage="No returns recorded." dense />
      </Section>
    </div>
  );
};

export default function ProductUnitDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [reloadKey, setReloadKey] = useState(0);
  // The answer for one request (`key`); any other reads as loading.
  const [result, setResult] = useState({ key: null, status: "loading", details: null });
  const requestKey = `${id}#${reloadKey}`;
  const current = result.key === requestKey;
  const status = current ? result.status : "loading"; // loading | ready | not_found | forbidden | error

  useEffect(() => {
    let live = true;
    getProductUnitDetails(id)
      .then((details) => {
        if (live) setResult({ key: requestKey, status: "ready", details });
      })
      .catch((error) => {
        if (!live) return;
        const code = error?.response?.status;
        const failed = code === 404 || code === 400 ? "not_found" : code === 403 ? "forbidden" : "error";
        setResult({ key: requestKey, status: failed, details: null });
      });
    return () => {
      live = false;
    };
  }, [id, requestKey]);

  const backPath = `/inventory/units${location.state?.from?.search ?? ""}`;
  const saleState = {
    from: { path: `/inventory/units/${id}`, label: "Product unit", state: location.state },
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <Link
        to={backPath}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft size={14} />
        Back to product units
      </Link>

      {status === "loading" && <Loading />}
      {status === "ready" && <Details details={result.details} saleState={saleState} />}
      {status === "not_found" && (
        <Message icon={Smartphone} title="Unit not found">
          This unit doesn't exist, or isn't available to you.
        </Message>
      )}
      {status === "forbidden" && (
        <Message icon={AlertCircle} title="Not accessible">
          You don't have access to this unit.
        </Message>
      )}
      {status === "error" && (
        <Message
          icon={AlertCircle}
          title="Couldn't load this unit"
          action={<Button variant="accent" label="Try again" onClick={() => setReloadKey((key) => key + 1)} />}
        >
          Something went wrong. Try again.
        </Message>
      )}
    </div>
  );
}
