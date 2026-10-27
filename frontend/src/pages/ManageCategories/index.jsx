import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  Plus,
  FolderTree,
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
import { listCategories } from "../../services/categoriesService";
import { fetchCategories } from "../../store/slices/categoriesSlice";
import CategoryFormDialog from "../../components/categories/CategoryFormDialog";
import DeactivateCategoryDialog from "../../components/categories/DeactivateCategoryDialog";

/**
 * ManageCategories Page
 *
 * Admin-manageable, all-authenticated-users-viewable page for the
 * category catalog.
 *
 * SCOPE (R1):
 * - Flat category list
 * - Search by name (client-side, small list)
 * - Per-row Edit + Deactivate/Reactivate for admins
 * - No filters — the list will be small in R1
 * - No detail page — three useful fields wouldn't fill one
 *
 * DATA STRATEGY:
 * Local state for the table (view-specific), fetched via listCategories
 * with includeInactive=true so admin can see and reactivate deactivated
 * categories. After every mutation:
 * 1. runFetch() — refreshes the local table
 * 2. dispatch(fetchCategories()) — refreshes product category dropdowns.
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

const ManageCategories = () => {
  const dispatch = useDispatch();
  const { can } = usePermissions();

  // Table data
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRequestIdRef = useRef(0);

  // Client-side search
  const [searchTerm, setSearchTerm] = useState("");

  // Dialog state
  const [formMode, setFormMode] = useState(null);
  const [formTarget, setFormTarget] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  // Fetch runner — same pattern as ManageBrands and ProductsList.
  const runFetch = () => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);

    listCategories({ includeInactive: true })
      .then((data) => {
        if (requestId !== fetchRequestIdRef.current) return;
        setCategories(data);
      })
      .catch((err) => {
        if (requestId !== fetchRequestIdRef.current) return;
        setError(
          err.response?.data?.message ||
            err.message ||
            "Failed to load categories",
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
    dispatch(fetchCategories());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side filter — trimmed, case-insensitive match on name
  const visibleCategories = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [categories, searchTerm]);

  // ============================================
  // HANDLERS
  // ============================================

  const handleNewCategory = () => {
    setFormTarget(null);
    setFormMode("create");
  };

  const handleEditCategory = (category) => {
    setFormTarget(category);
    setFormMode("edit");
  };

  const handleCloseForm = () => {
    setFormMode(null);
    setFormTarget(null);
  };

  const handleToggleActive = (category) => {
    setDeactivateTarget(category);
  };

  const handleCloseDeactivate = () => {
    setDeactivateTarget(null);
  };

  // Called after any successful mutation (create, edit, deactivate, reactivate)
  const handleMutationSuccess = () => {
    handleCloseForm();
    handleCloseDeactivate();
    runFetch();
    // Refresh the slice so product forms see the change immediately.
    dispatch(fetchCategories());
  };

  // ============================================
  // TABLE COLUMN CONFIG
  // ============================================

  const canManage = can(PERMISSIONS.MANAGE_CATEGORIES);

  const renderActions = (row) => {
    if (!canManage) return null;
    return (
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={Edit3}
          onClick={() => handleEditCategory(row)}
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
      header: "Category",
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
            <FolderTree
              size={20}
              className="text-cyan-600 dark:text-cyan-400"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Categories
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {loading
                ? "Loading..."
                : searchTerm
                  ? `${visibleCategories.length} of ${categories.length} shown`
                  : `${categories.length} total`}
            </p>
          </div>
        </div>

        {canManage && (
          <Button
            variant="accent"
            icon={Plus}
            onClick={handleNewCategory}
            label="New category"
          />
        )}
      </div>

      {/* Search bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-4">
        <InputField
          type="text"
          name="search"
          placeholder="Search categories by name"
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
              Couldn't load categories
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
        data={visibleCategories}
        loading={loading}
        emptyMessage={
          searchTerm
            ? `No categories match "${searchTerm}"`
            : canManage
              ? "No categories yet. Click New category to add the first one."
              : "No categories yet."
        }
      />

      {/* Dialogs */}
      <CategoryFormDialog
        open={formMode !== null}
        onClose={handleCloseForm}
        onSuccess={handleMutationSuccess}
        mode={formMode || "create"}
        category={formTarget}
      />

      <DeactivateCategoryDialog
        open={deactivateTarget !== null}
        onClose={handleCloseDeactivate}
        onSuccess={handleMutationSuccess}
        category={deactivateTarget}
        action={deactivateTarget?.is_active ? "deactivate" : "reactivate"}
      />
    </div>
  );
};

export default ManageCategories;
