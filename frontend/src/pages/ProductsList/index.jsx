import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Package, AlertCircle } from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Select from "../../components/common/Select";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS } from "../../constants/rolePermissions";
import { listProducts } from "../../services/productsService";
import {
  fetchBranches,
  selectActiveBranches,
  selectBranchesInitialized,
} from "../../store/slices/branchesSlice";
import {
  fetchBrands,
  selectActiveBrands,
  selectBrandsInitialized,
} from "../../store/slices/brandsSlice";
import {
  fetchCategories,
  selectActiveCategories,
  selectCategoriesInitialized,
} from "../../store/slices/categoriesSlice";

/**
 * ProductsList Page
 *
 * Lists all products with filters. Path B step 4.
 *
 * FILTERING STRATEGY:
 * - Server-side: brand, category, branch, product_type, includeInactive
 *   → refetch from backend when any of these change
 * - Client-side: text search on name/SKU/barcode
 *   → filter the in-memory list without a refetch
 *
 * Rationale: the backend supports the structural filters (see Swagger),
 * so we let it do the DB work. Text search has no backend param, and
 * client-side filtering gives instant feedback on typing.
 *
 * When the catalog reaches ~10k products (well past R1), we add a
 * server-side search param and delete the client-side filter.
 */

// LKR currency formatter — reused per row, memoized as module-level constant.
const currencyFormatter = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatPrice = (priceStr) => {
  const n = Number(priceStr);
  if (!Number.isFinite(n)) return priceStr;
  return currencyFormatter.format(n);
};

const PRODUCT_TYPES = [
  { value: "", label: "All types" },
  { value: "PHONE", label: "Phone" },
  { value: "ACCESSORY", label: "Accessory" },
  { value: "WATCH", label: "Watch" },
  { value: "SPEAKER", label: "Speaker" },
];

const ProductsList = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { can } = usePermissions();

  // Filter state — structural filters trigger a refetch, search is client-side
  const [filters, setFilters] = useState({
    brandId: "",
    categoryId: "",
    branchId: "",
    productType: "",
    includeInactive: false,
  });
  const [searchTerm, setSearchTerm] = useState("");

  // Products list — local state, not Redux (view-specific data)
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Tracks the latest fetch request so out-of-order responses don't overwrite state
  const fetchRequestIdRef = useRef(0);

  // Reference data from Redux slices
  const branches = useSelector(selectActiveBranches);
  const branchesInitialized = useSelector(selectBranchesInitialized);
  const brands = useSelector(selectActiveBrands);
  const brandsInitialized = useSelector(selectBrandsInitialized);
  const categories = useSelector(selectActiveCategories);
  const categoriesInitialized = useSelector(selectCategoriesInitialized);

  // Kick off reference data fetches once
  useEffect(() => {
    if (!branchesInitialized) dispatch(fetchBranches());
    if (!brandsInitialized) dispatch(fetchBrands());
    if (!categoriesInitialized) dispatch(fetchCategories());
  }, [dispatch, branchesInitialized, brandsInitialized, categoriesInitialized]);

  // Fetch runner — used by both the initial mount effect and the filter handlers.
  // We track the last request with a ref-like closure via a cancel token so a
  // slow response can't overwrite a newer one.
  const runFetch = (nextFilters) => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);

    listProducts(nextFilters)
      .then((data) => {
        // Ignore if a newer request has been fired since
        if (requestId !== fetchRequestIdRef.current) return;
        setProducts(data);
      })
      .catch((err) => {
        if (requestId !== fetchRequestIdRef.current) return;
        setError(
          err.response?.data?.message ||
            err.message ||
            "Failed to load products",
        );
      })
      .finally(() => {
        if (requestId !== fetchRequestIdRef.current) return;
        setLoading(false);
      });
  };

  // Initial fetch on mount. Subsequent fetches are triggered by filter change
  // handlers, not by dep changes on this effect — that's why the dep array is
  // empty and why we suppress the setState-in-effect rule for this one call.
  // The initial mount is the ONE case where fetching from an effect is
  // legitimately required: there's no user event to hang the fetch on.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side search — filters the already-fetched list in memory
  const visibleProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const sku = (p.sku || "").toLowerCase();
      const barcode = (p.barcode || "").toLowerCase();
      return name.includes(q) || sku.includes(q) || barcode.includes(q);
    });
  }, [products, searchTerm]);

  // ============================================
  // TABLE COLUMN CONFIG
  // ============================================

  const renderProduct = (row) => {
    const specParts = [
      row.phone_storage,
      row.phone_color,
      row.phone_ram,
    ].filter(Boolean);
    const specs =
      specParts.length > 0 ? specParts.join(" · ") : row.description;
    return (
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-100">
          {row.name}
        </div>
        {specs && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
            {specs}
          </div>
        )}
      </div>
    );
  };

  const renderSku = (row) => (
    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
      {row.sku}
    </span>
  );

  const renderBrand = (row) => row.brand?.name || "—";

  const renderPrice = (row) => (
    <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">
      {formatPrice(row.selling_price)}
    </span>
  );

  const renderStatus = (row) => {
    if (!row.is_active) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          Inactive
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
        Active
      </span>
    );
  };

  const columns = [
    {
      key: "product",
      header: "Product",
      render: renderProduct,
      primary: true,
    },
    {
      key: "sku",
      header: "SKU",
      render: renderSku,
      mobileHidden: true,
    },
    {
      key: "brand",
      header: "Brand",
      render: renderBrand,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: renderPrice,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: renderStatus,
    },
  ];

  // ============================================
  // HANDLERS
  // ============================================

  const handleFilterChange = (field) => (e) => {
    const nextFilters = { ...filters, [field]: e.target.value };
    setFilters(nextFilters);
    runFetch(nextFilters);
  };

  const handleInactiveToggle = () => {
    const nextFilters = {
      ...filters,
      includeInactive: !filters.includeInactive,
    };
    setFilters(nextFilters);
    runFetch(nextFilters);
  };

  const handleRowClick = (row) => {
    navigate(`/products/${row.id}`);
  };

  const handleNewProduct = () => {
    navigate("/products/new");
  };

  // ============================================
  // RENDER
  // ============================================

  const canCreate = can(PERMISSIONS.CREATE_PRODUCT);

  const branchOptions = [
    { value: "", label: "All branches" },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];
  const brandOptions = [
    { value: "", label: "All brands" },
    ...brands.map((b) => ({ value: b.id, label: b.name })),
  ];
  const categoryOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

    return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
              <Package size={20} className="text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                Products
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {loading
                  ? "Loading..."
                  : `${visibleProducts.length} of ${products.length} shown`}
              </p>
            </div>
          </div>

          {canCreate && (
            <Button
              variant="accent"
              icon={Plus}
              onClick={handleNewProduct}
              label="New product"
            />
          )}
        </div>

        {/* Filters bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-4 space-y-3">
          {/* Search + inactive toggle */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <InputField
                type="text"
                name="search"
                placeholder="Search by name, SKU, or barcode"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                icon={Search}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap px-1">
              <input
                type="checkbox"
                checked={filters.includeInactive}
                onChange={handleInactiveToggle}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500 [color-scheme:light] dark:[color-scheme:dark]"
              />
              Show inactive
            </label>
          </div>

          {/* Structural filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Select
              name="brand"
              value={filters.brandId}
              onChange={handleFilterChange("brandId")}
              options={brandOptions}
              placeholder="All brands"
            />
            <Select
              name="category"
              value={filters.categoryId}
              onChange={handleFilterChange("categoryId")}
              options={categoryOptions}
              placeholder="All categories"
            />
            <Select
              name="branch"
              value={filters.branchId}
              onChange={handleFilterChange("branchId")}
              options={branchOptions}
              placeholder="All branches"
            />
            <Select
              name="productType"
              value={filters.productType}
              onChange={handleFilterChange("productType")}
              options={PRODUCT_TYPES}
              placeholder="All types"
            />
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-4 flex items-start gap-3">
            <AlertCircle
              size={18}
              className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Couldn't load products
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Table */}
        <Table
          columns={columns}
          data={visibleProducts}
          loading={loading}
          onRowClick={handleRowClick}
          emptyMessage={
            searchTerm ? `No products match "${searchTerm}"` : "No products yet"
          }
        />
      </div>
  );
};

export default ProductsList;
