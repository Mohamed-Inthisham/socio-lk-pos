import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  Plus,
  Tag,
  AlertCircle,
  Edit3,
  PowerOff,
  Power,
  Search,
} from "lucide-react";
import Button from "../../components/common/Button";
import InputField from "../../components/common/InputField";
import Table from "../../components/common/Table";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS } from "../../constants/rolePermissions";
import { listBrands } from "../../services/brandsService";
import { fetchBrands } from "../../store/slices/brandsSlice";
import BrandFormDialog from "../../components/brands/BrandFormDialog";
import DeactivateBrandDialog from "../../components/brands/DeactivateBrandDialog";

/**
 * ManageBrands Page
 *
 * Admin-only page for managing the brand catalog. Path B step 8.
 *
 * SCOPE (R1):
 * - Table of all brands (active + inactive, no filter)
 * - New brand button (opens BrandFormDialog in create mode)
 * - Per-row Edit button (opens BrandFormDialog in edit mode)
 * - Per-row Deactivate/Reactivate button (opens DeactivateBrandDialog)
 *
 * NOT INCLUDED IN R1:
 * - Search bar (brand list is small — Apple, Samsung, Xiaomi, ~30 max
 *   for a Sri Lankan mobile shop)
 * - Show-inactive toggle (admin needs to see inactive brands to
 *   reactivate them; always fetching everything is simpler)
 * - Detail page (brand has 2 useful fields; a detail page would be
 *   almost empty and add navigation friction)
 *
 * DATA STRATEGY:
 * Local state for the table (view-specific data), fetched via
 * listBrands. After every mutation, we do TWO refetches:
 * 1. listBrands() — refreshes the local table
 * 2. dispatch(fetchBrands()) — refreshes the Redux slice so the
 *    product filter dropdowns and product forms see the change
 *    immediately without needing a full page reload.
 *
 * The out-of-order-response guard (fetchRequestIdRef) is copied from
 * ProductsList — small local list so it's overkill today, but the
 * pattern is cheap and matches sibling pages.
 */

// ============================================
// TABLE CELL RENDERERS
// ============================================

const renderName = (row) => (
  <div className="font-medium text-slate-900 dark:text-slate-100">
    {row.name}
  </div>
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

// ============================================
// MAIN COMPONENT
// ============================================

const ManageBrands = () => {
  const dispatch = useDispatch();
  const { can } = usePermissions();

  // Table data
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRequestIdRef = useRef(0);

  // Client-side search — no backend param needed, list is small
  const [searchTerm, setSearchTerm] = useState("");
  // Dialog state
  // formMode: null = closed, "create" = new brand, "edit" = editing formTarget
  const [formMode, setFormMode] = useState(null);
  const [formTarget, setFormTarget] = useState(null);
  // deactivate dialog: null = closed, brand object = open on that brand.
  // Which action (deactivate vs reactivate) is derived from brand.is_active.
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  // Fetch runner — same pattern as ProductsList. Always fetches with
  // includeInactive=true so admin can see and reactivate deactivated brands.
  const runFetch = () => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);

    listBrands({ includeInactive: true })
      .then((data) => {
        if (requestId !== fetchRequestIdRef.current) return;
        setBrands(data);
      })
      .catch((err) => {
        if (requestId !== fetchRequestIdRef.current) return;
        setError(
          err.response?.data?.message || err.message || "Failed to load brands",
        );
      })
      .finally(() => {
        if (requestId !== fetchRequestIdRef.current) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // HANDLERS
  // ============================================

  const handleNewBrand = () => {
    setFormTarget(null);
    setFormMode("create");
  };

  const handleEditBrand = (brand) => {
    setFormTarget(brand);
    setFormMode("edit");
  };

  const handleCloseForm = () => {
    setFormMode(null);
    setFormTarget(null);
  };

  const handleToggleActive = (brand) => {
    setDeactivateTarget(brand);
  };

  const handleCloseDeactivate = () => {
    setDeactivateTarget(null);
  };

  // Called after any successful mutation (create, edit, deactivate, reactivate)
  const handleMutationSuccess = () => {
    handleCloseForm();
    handleCloseDeactivate();
    runFetch();
    // Also refresh the Redux slice so product filters/forms see the change
    // without needing a full page reload.
    dispatch(fetchBrands());
  };

  // Client-side filter — trimmed, case-insensitive match on name
  const visibleBrands = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => (b.name || "").toLowerCase().includes(q));
  }, [brands, searchTerm]);

  // ============================================
  // TABLE COLUMN CONFIG
  // ============================================

  const canManage = can(PERMISSIONS.MANAGE_BRANDS);

  const renderActions = (row) => {
    if (!canManage) return null;
    return (
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={Edit3}
          onClick={() => handleEditBrand(row)}
          label="Edit"
        />
        {row.is_active ? (
          <Button
            size="sm"
            variant="danger"
            icon={PowerOff}
            onClick={() => handleToggleActive(row)}
            label="Deactivate"
          />
        ) : (
          <Button
            size="sm"
            variant="accent"
            icon={Power}
            onClick={() => handleToggleActive(row)}
            label="Reactivate"
          />
        )}
      </div>
    );
  };

  const columns = [
    {
      key: "name",
      header: "Brand",
      render: renderName,
      primary: true,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: renderStatus,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: renderActions,
    },
  ];

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
            <Tag size={20} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Brands
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {loading
                ? "Loading..."
                : searchTerm
                  ? `${visibleBrands.length} of ${brands.length} shown`
                  : `${brands.length} total`}
            </p>
          </div>
        </div>

        {canManage && (
          <Button
            variant="accent"
            icon={Plus}
            onClick={handleNewBrand}
            label="New brand"
          />
        )}
      </div>

      {/* Search bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-4">
        <InputField
          type="text"
          name="search"
          placeholder="Search brands by name"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          icon={Search}
        />
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
              Couldn't load brands
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
        data={visibleBrands}
        loading={loading}
        emptyMessage={
          searchTerm
            ? `No brands match "${searchTerm}"`
            : "No brands yet. Click New brand to add the first one."
        }
      />

      {/* Dialogs — mounted conditionally so useEffect resets fire on open */}
      <BrandFormDialog
        open={formMode !== null}
        onClose={handleCloseForm}
        onSuccess={handleMutationSuccess}
        mode={formMode || "create"}
        brand={formTarget}
      />

      <DeactivateBrandDialog
        open={deactivateTarget !== null}
        onClose={handleCloseDeactivate}
        onSuccess={handleMutationSuccess}
        brand={deactivateTarget}
        action={deactivateTarget?.is_active ? "deactivate" : "reactivate"}
      />
    </div>
  );
};;;

export default ManageBrands;
