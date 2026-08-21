/**
 * Role-Based Permissions Configuration
 *
 * Single source of truth for all role permissions in SOCIO.LK POS.
 *
 * STRATEGY: "Visible but Disabled" UI Pattern
 * - All roles see the same UI
 * - Unauthorized actions are disabled, not hidden
 * - Tooltips explain why actions are unavailable
 *
 * IMPORTANT: Frontend permissions are for UX ONLY.
 * Backend MUST enforce these permissions for security.
 *
 * Adding new permissions:
 * 1. Add the permission key here for each role
 * 2. Use it in components via usePermissions() hook
 * 3. Optionally restrict routes via RoleProtectedRoute
 */

// ============================================
// USER ROLES
// ============================================

export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  CASHIER: "cashier",
};

// ============================================
// PERMISSION DEFINITIONS
// ============================================

export const PERMISSIONS = {
  // ===== DASHBOARD =====
  VIEW_DASHBOARD: "view_dashboard",
  VIEW_REPORTS: "view_reports",

  // ===== PRODUCTS =====
  VIEW_PRODUCTS: "view_products",
  CREATE_PRODUCT: "create_product",
  EDIT_PRODUCT: "edit_product",
  DELETE_PRODUCT: "delete_product",

  // ===== CATALOG (brands, categories) =====
  MANAGE_BRANDS: "manage_brands",

  // ===== INVENTORY =====
  VIEW_INVENTORY: "view_inventory",
  ADJUST_STOCK: "adjust_stock",

  // ===== SALES / POS =====
  VIEW_SALES: "view_sales",
  CREATE_SALE: "create_sale",
  VOID_SALE: "void_sale",
  REFUND_SALE: "refund_sale",
  APPLY_DISCOUNT: "apply_discount",

  // ===== CUSTOMERS =====
  VIEW_CUSTOMERS: "view_customers",
  CREATE_CUSTOMER: "create_customer",
  EDIT_CUSTOMER: "edit_customer",
  DELETE_CUSTOMER: "delete_customer",

  // ===== USERS (Admin only typically) =====
  VIEW_USERS: "view_users",
  CREATE_USER: "create_user",
  EDIT_USER: "edit_user",
  DELETE_USER: "delete_user",

  // ===== SETTINGS =====
  VIEW_SETTINGS: "view_settings",
  EDIT_SETTINGS: "edit_settings",
};

// ============================================
// ROLE → PERMISSIONS MAPPING
// ============================================

export const ROLE_PERMISSIONS = {
  // 👑 ADMIN: Full access to everything
  [ROLES.ADMIN]: [
    // Dashboard
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,

    // Products - Full CRUD
    PERMISSIONS.VIEW_PRODUCTS,
    PERMISSIONS.CREATE_PRODUCT,
    PERMISSIONS.EDIT_PRODUCT,
    PERMISSIONS.DELETE_PRODUCT,

    // Catalog - Brands and categories
    PERMISSIONS.MANAGE_BRANDS,

    // Inventory - Full control
    PERMISSIONS.VIEW_INVENTORY,
    PERMISSIONS.ADJUST_STOCK,

    // Sales - Full control
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.CREATE_SALE,
    PERMISSIONS.VOID_SALE,
    PERMISSIONS.REFUND_SALE,
    PERMISSIONS.APPLY_DISCOUNT,

    // Customers - Full CRUD
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.CREATE_CUSTOMER,
    PERMISSIONS.EDIT_CUSTOMER,
    PERMISSIONS.DELETE_CUSTOMER,

    // Users - Full control (admin exclusive area)
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    PERMISSIONS.DELETE_USER,

    // Settings - Full access
    PERMISSIONS.VIEW_SETTINGS,
    PERMISSIONS.EDIT_SETTINGS,
  ],

  // 👔 MANAGER: View everything, limited modifications
  [ROLES.MANAGER]: [
    // Dashboard
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,

    // Products - View only in R1 (backend enforces admin-only mutations)
    PERMISSIONS.VIEW_PRODUCTS,

    // Inventory - View only in R1 (backend enforces admin-only mutations)
    PERMISSIONS.VIEW_INVENTORY,

    // Sales - Most actions
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.CREATE_SALE,
    PERMISSIONS.VOID_SALE,
    PERMISSIONS.APPLY_DISCOUNT,

    // Customers - Manage
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.CREATE_CUSTOMER,
    PERMISSIONS.EDIT_CUSTOMER,

    // Users - View only
    PERMISSIONS.VIEW_USERS,

    // Settings - View only
    PERMISSIONS.VIEW_SETTINGS,
  ],

  // 🛒 CASHIER: Mostly view + create sales
  [ROLES.CASHIER]: [
    // Dashboard
    PERMISSIONS.VIEW_DASHBOARD,

    // Products - View only
    PERMISSIONS.VIEW_PRODUCTS,

    // Inventory - View only
    PERMISSIONS.VIEW_INVENTORY,

    // Sales - Primary function
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.CREATE_SALE,

    // Customers - View and create only
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.CREATE_CUSTOMER,
  ],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a role has a specific permission
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
export const hasPermission = (role, permission) => {
  if (!role || !permission) return false;

  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  return permissions.includes(permission);
};

/**
 * Get all permissions for a role
 * @param {string} role - User role
 * @returns {string[]}
 */
export const getRolePermissions = (role) => {
  return ROLE_PERMISSIONS[role] || [];
};

/**
 * Check if a role exists
 * @param {string} role - Role to check
 * @returns {boolean}
 */
export const isValidRole = (role) => {
  return Object.values(ROLES).includes(role);
};

/**
 * Get display info for a role (useful for UI)
 */
export const ROLE_INFO = {
  [ROLES.ADMIN]: {
    label: "Administrator",
    emoji: "👑",
    color: "bg-purple-100 text-purple-700",
  },
  [ROLES.MANAGER]: {
    label: "Manager",
    emoji: "👔",
    color: "bg-blue-100 text-blue-700",
  },
  [ROLES.CASHIER]: {
    label: "Cashier",
    emoji: "🛒",
    color: "bg-green-100 text-green-700",
  },
};
