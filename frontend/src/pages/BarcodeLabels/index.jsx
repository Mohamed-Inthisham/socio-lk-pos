import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Barcode, Loader2, Plus, Printer, Search, X } from "lucide-react";
import { listProducts } from "../../services/productsService";
import { listAllProductUnits } from "../../services/productUnitsService";
import { listBranches } from "../../services/branchesService";
import { code128Bars } from "../../utils/code128";

const PAGE_SIZE = 200;
const LABEL_SIZES = {
  "50x25": { width: "50mm", height: "25mm" },
  "40x20": { width: "40mm", height: "20mm" },
  "30x20": { width: "30mm", height: "20mm" },
};
const money = (value) =>
  value === null || value === undefined || value === ""
    ? ""
    : new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(Number(value));

const BarcodeSvg = ({ value }) => {
  const encoded = code128Bars(value);
  if (!encoded) return <div className="text-xs text-red-600">Code cannot be printed</div>;
  const quiet = 10;
  return (
    <svg viewBox={`0 0 ${encoded.width + quiet * 2} 48`} className="barcode-svg" role="img" aria-label={`Barcode ${value}`}>
      <rect width="100%" height="100%" fill="white" />
      {encoded.bars.map((bar, index) => (
        <rect key={index} x={bar.x + quiet} y="0" width={bar.width} height="48" fill="black" />
      ))}
    </svg>
  );
};

const BarcodeLabels = () => {
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [units, setUnits] = useState([]);
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [source, setSource] = useState("PRODUCT");
  const [size, setSize] = useState("50x25");
  const [priceType, setPriceType] = useState("selling_price");
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [unitLoading, setUnitLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      listProducts({ limit: PAGE_SIZE }),
      listBranches(),
    ])
      .then(([productPage, branchList]) => {
        if (!active) return;
        setProducts(productPage.data ?? []);
        setBranches(branchList ?? []);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Couldn't load products.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!source.startsWith("UNIT_")) {
      setUnits([]);
      return () => { active = false; };
    }
    setUnitLoading(true);
    listAllProductUnits({ status: "IN_STOCK", ...(branchId ? { branchId } : {}) })
      .then((rows) => active && setUnits(rows))
      .catch((err) => active && setError(err.response?.data?.message || "Couldn't load in stock item identifiers."))
      .finally(() => active && setUnitLoading(false));
    return () => { active = false; };
  }, [source, branchId]);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) =>
      !needle || [product.name, product.model, product.sku, product.barcode]
        .some((value) => String(value ?? "").toLowerCase().includes(needle)),
    );
  }, [products, query]);

  const addProduct = (product) => {
    setQueue((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      return existing
        ? current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { product, quantity: 1 }];
    });
  };
  const updateQuantity = (id, value) => {
    const quantity = Math.max(1, Math.min(500, Number.parseInt(value, 10) || 1));
    setQueue((current) => current.map((item) => item.product.id === id ? { ...item, quantity } : item));
  };
  const removeProduct = (id) => setQueue((current) => current.filter((item) => item.product.id !== id));

  const labels = useMemo(() => queue.flatMap(({ product, quantity }) => {
    if (source.startsWith("UNIT_")) {
      return units
        .filter((unit) => unit.product_id === product.id)
        .flatMap((unit) => {
          const legacyOnly = !unit.imei_number && !unit.serial_number;
          const imei = unit.imei_number || (legacyOnly && product.tracking_method === "IMEI" ? unit.imei : null);
          const serial = unit.serial_number || (legacyOnly && product.tracking_method === "SERIAL_NUMBER" ? unit.imei : null);
          const codes = source === "UNIT_IMEI"
            ? (imei ? [{ code: imei, suffix: "imei" }] : [])
            : source === "UNIT_SERIAL"
              ? (serial ? [{ code: serial, suffix: "serial" }] : [])
              : [imei && { code: imei, suffix: "imei" }, serial && serial !== imei && { code: serial, suffix: "serial" }].filter(Boolean);
          return codes.map(({ code, suffix }) => ({
            key: `${unit.id}-${suffix}`,
            product,
            code,
            price: priceType === "none"
              ? null
              : priceType === "buying_price"
                ? unit.buying_price
                : unit.selling_price ?? product.selling_price,
          }));
        });
    }
    const code = product.barcode || product.sku;
    return Array.from({ length: quantity }, (_, index) => ({
      key: `${product.id}-${index}`,
      product,
      code,
      price: product[priceType],
    }));
  }), [queue, source, units, priceType]);

  const printLabels = () => {
    if (labels.length) window.print();
  };

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-cyan-500/10 p-3 text-cyan-500"><Barcode size={22} /></div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Barcode Labels</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Build a sheet of scannable labels and print them for your products.</p>
        </div>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300"><AlertCircle size={16} />{error}<button className="ml-auto" onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.25fr)]">
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Add Products</h2>
            <label className="relative mb-3 block">
              <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product / SKU / barcode..." className="h-11 w-full rounded-lg border border-slate-700 bg-slate-800 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none" />
            </label>
            <div className="max-h-80 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
              {loading ? <div className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />Loading products…</div> : filteredProducts.map((product) => (
                <div key={product.id} className="flex items-center gap-3 p-3 hover:bg-slate-800/70">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-100">{product.name}</p><p className="truncate text-xs text-slate-400">{product.sku} · {money(product.selling_price) || "Price not set"}</p></div>
                  <button type="button" onClick={() => addProduct(product)} aria-label={`Add ${product.name}`} className="rounded-lg bg-slate-800 p-2 text-cyan-400 hover:bg-cyan-900/40"><Plus size={18} /></button>
                </div>
              ))}
              {!loading && filteredProducts.length === 0 && <p className="p-4 text-sm text-slate-400">No products found.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-100">Label Queue</h2><button type="button" onClick={() => setQueue([])} disabled={!queue.length} className="text-sm text-red-400 hover:text-red-300 disabled:opacity-40">Clear all</button></div>
            {queue.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">Add products to start a label sheet.</p> : <div className="space-y-2">
              {queue.map(({ product, quantity }) => (
                <div key={product.id} className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-100">{product.name}</p><p className="text-xs text-slate-400">{product.sku}</p></div>
                  {source === "PRODUCT" && <label className="flex items-center gap-2 text-xs text-slate-400">Qty<input aria-label={`Quantity for ${product.name}`} type="number" min="1" max="500" value={quantity} onChange={(event) => updateQuantity(product.id, event.target.value)} className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-center text-sm text-slate-100" /></label>}
              {source.startsWith("UNIT_") && <span className="text-xs text-slate-400">{units.filter((unit) => unit.product_id === product.id).length} in stock</span>}
                  <button type="button" onClick={() => removeProduct(product.id)} aria-label={`Remove ${product.name}`} className="text-slate-500 hover:text-red-400"><X size={18} /></button>
                </div>
              ))}
            </div>}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Label Options</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-400">Label size<select value={size} onChange={(event) => setSize(event.target.value)} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100"><option value="50x25">50 × 25 mm</option><option value="40x20">40 × 20 mm</option><option value="30x20">30 × 20 mm</option></select></label>
              <label className="space-y-1 text-xs text-slate-400">Code source<select value={source} onChange={(event) => setSource(event.target.value)} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100"><option value="PRODUCT">Product barcode (fallback SKU)</option><option value="UNIT_IMEI">IMEI (in stock units)</option><option value="UNIT_SERIAL">Serial number (in stock units)</option><option value="UNIT_BOTH">Both identifiers (two labels per unit)</option></select></label>
              {source.startsWith("UNIT_") && <label className="space-y-1 text-xs text-slate-400">Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100"><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
              <label className="space-y-1 text-xs text-slate-400">Symbology<select value="CODE128" disabled className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100"><option value="CODE128">CODE 128</option></select></label>
              <label className="space-y-1 text-xs text-slate-400">Price shown<select value={priceType} onChange={(event) => setPriceType(event.target.value)} className="h-10 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100"><option value="selling_price">Selling price</option><option value="buying_price">Cost price</option><option value="none">No price</option></select></label>
            </div>
            <div className="my-4 flex flex-wrap gap-2">{[[showName, setShowName, "Name"], [showPrice, setShowPrice, "Price"], [showCode, setShowCode, "Code text"]].map(([checked, setter, label]) => <label key={label} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300"><input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} />{label}</label>)}</div>
            <button type="button" onClick={printLabels} disabled={!labels.length || unitLoading} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"><Printer size={17} />Print Labels</button>
            {unitLoading && <p className="mt-2 text-xs text-slate-400">Loading in stock identifiers…</p>}
          </section>
        </div>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"><h2 className="font-semibold text-slate-100">Preview</h2><span className="text-xs text-slate-400">{labels.length} labels</span></div>
          <div className="barcode-preview rounded-xl border border-slate-800 bg-slate-900 p-4">
            {labels.length === 0 ? <p className="py-12 text-center text-sm text-slate-400">Your labels will appear here.</p> : <div className="barcode-grid">{labels.map(({ key, product, code, price }) => <article key={key} className="barcode-label" style={{ width: LABEL_SIZES[size].width, minHeight: LABEL_SIZES[size].height }}>
              {showName && <div className="barcode-name">{product.name}</div>}
              <BarcodeSvg value={code} />
              {showCode && <div className="barcode-code">{code}</div>}
              {showPrice && priceType !== "none" && price && <div className="barcode-price">{money(price)}</div>}
            </article>)}</div>}
          </div>
        </section>
      </div>
      <style>{`
        .barcode-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; align-content:start; }
        .barcode-label { display:flex; flex-direction:column; justify-content:center; align-items:center; overflow:hidden; gap:1px; padding:3mm 2mm; border:1px dashed #475569; background:#fff; color:#111827; text-align:center; }
        .barcode-name { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 8pt Arial,sans-serif; }
        .barcode-svg { display:block; width:100%; max-height:12mm; }
        .barcode-code { font:6pt Arial,sans-serif; letter-spacing:.2px; }
        .barcode-price { font:700 8pt Arial,sans-serif; }
        @media print {
          @page { margin:5mm; }
          body * { visibility:hidden !important; }
          .barcode-preview, .barcode-preview * { visibility:visible !important; }
          .barcode-preview { position:absolute !important; inset:0 auto auto 0 !important; width:100% !important; margin:0 !important; padding:0 !important; border:0 !important; background:white !important; overflow:visible !important; }
          .barcode-preview .barcode-grid { display:grid; grid-template-columns:repeat(auto-fill,${LABEL_SIZES[size].width}); gap:0; }
          .barcode-preview .barcode-label { width:${LABEL_SIZES[size].width} !important; height:${LABEL_SIZES[size].height} !important; min-height:${LABEL_SIZES[size].height} !important; padding:2mm !important; border:0.15mm dashed #aaa !important; break-inside:avoid; }
        }
      `}</style>
    </main>
  );
};

export default BarcodeLabels;
