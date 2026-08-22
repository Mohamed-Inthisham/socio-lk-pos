import { useDispatch, useSelector } from "react-redux";
import usePermissions from "../../hooks/usePermissions";
import { PERMISSIONS, ROLE_INFO } from "../../constants/rolePermissions";
import { logoutUser } from "../../store/slices/authSlice";
import ThemeToggle from "../../components/common/ThemeToggle";

/**
 * Dashboard Demo Page
 *
 * Temporary page to demonstrate role-based permissions.
 * Shows how different actions are enabled/disabled per role.
 *
 * NOTE: Path B added dark mode support (dark: variants throughout) and a
 * ThemeToggle in the header for end-to-end testing of the theme store.
 * This whole page will be replaced by the real dashboard in Phase 6.8.
 */
const DashboardDemo = () => {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const { can, role } = usePermissions();

  const roleInfo = ROLE_INFO[role] || {};

  const handleLogout = () => {
    dispatch(logoutUser());
  };

  const productActions = [
    {
      label: "View Products",
      permission: PERMISSIONS.VIEW_PRODUCTS,
      icon: "👀",
    },
    {
      label: "Add Product",
      permission: PERMISSIONS.CREATE_PRODUCT,
      icon: "➕",
    },
    { label: "Edit Product", permission: PERMISSIONS.EDIT_PRODUCT, icon: "✏️" },
    {
      label: "Delete Product",
      permission: PERMISSIONS.DELETE_PRODUCT,
      icon: "🗑️",
    },
  ];

  const salesActions = [
    { label: "View Sales", permission: PERMISSIONS.VIEW_SALES, icon: "📊" },
    { label: "Create Sale", permission: PERMISSIONS.CREATE_SALE, icon: "💰" },
    { label: "Void Sale", permission: PERMISSIONS.VOID_SALE, icon: "❌" },
    { label: "Refund Sale", permission: PERMISSIONS.REFUND_SALE, icon: "↩️" },
    {
      label: "Apply Discount",
      permission: PERMISSIONS.APPLY_DISCOUNT,
      icon: "🎯",
    },
  ];

  const userActions = [
    { label: "View Users", permission: PERMISSIONS.VIEW_USERS, icon: "👥" },
    { label: "Create User", permission: PERMISSIONS.CREATE_USER, icon: "➕" },
    { label: "Edit User", permission: PERMISSIONS.EDIT_USER, icon: "✏️" },
    { label: "Delete User", permission: PERMISSIONS.DELETE_USER, icon: "🗑️" },
  ];

  const renderActionButton = (action) => {
    const allowed = can(action.permission);
    return (
      <button
        key={action.permission}
        disabled={!allowed}
        title={
          allowed
            ? ""
            : `${roleInfo.label}s cannot ${action.label.toLowerCase()}`
        }
        className={`
          px-4 py-2 rounded-lg text-sm font-medium transition-all
          flex items-center gap-2
          ${
            allowed
              ? "bg-cyan-600 text-white hover:bg-cyan-700 cursor-pointer"
              : "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed"
          }
        `}
      >
        <span>{action.icon}</span>
        <span>{action.label}</span>
        {!allowed && <span className="text-xs">🔒</span>}
      </button>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              Dashboard Demo
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Welcome,{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {user?.name}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Role Badge */}
            <span
              className={`px-4 py-2 rounded-full text-sm font-semibold ${roleInfo.color}`}
            >
              {roleInfo.emoji} {roleInfo.label}
            </span>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            💡 <strong>Demo Mode:</strong> This page demonstrates role-based
            permissions. Buttons you don't have access to are disabled. Try
            logging in as different roles!
          </p>
        </div>

        {/* Products Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">
            📦 Product Management
          </h2>
          <div className="flex flex-wrap gap-3">
            {productActions.map(renderActionButton)}
          </div>
        </div>

        {/* Sales Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">
            💰 Sales & POS
          </h2>
          <div className="flex flex-wrap gap-3">
            {salesActions.map(renderActionButton)}
          </div>
        </div>

        {/* Users Section */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">
            👥 User Management (Admin Only)
          </h2>
          <div className="flex flex-wrap gap-3">
            {userActions.map(renderActionButton)}
          </div>
        </div>

        {/* User Info Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">
            🔐 Current Session Info
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500 dark:text-slate-400">User ID</p>
              <p className="font-mono text-slate-800 dark:text-slate-200 truncate">
                {user?.id}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Email</p>
              <p className="font-mono text-slate-800 dark:text-slate-200 truncate">
                {user?.email}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Role</p>
              <p className="font-mono text-slate-800 dark:text-slate-200">
                {role}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Branch</p>
              <p className="font-mono text-slate-800 dark:text-slate-200 truncate">
                {user?.branch?.name || "—"}
              </p>
            </div>
          </div>
        </div>
      </div>
  );
};

export default DashboardDemo;
