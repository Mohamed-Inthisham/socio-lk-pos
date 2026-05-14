import { useSelector } from "react-redux";
import { hasPermission, ROLES } from "../constants/rolePermissions";

/**
 * usePermissions Custom Hook
 *
 * Provides easy access to current user's permissions throughout the app.
 *
 * Usage:
 *   const { can, role, isAdmin, isManager, isCashier } = usePermissions();
 *
 *   // Check specific permission
 *   if (can('delete_product')) { ... }
 *
 *   // Quick role checks
 *   if (isAdmin) { ... }
 *
 *   // Use in JSX
 *   <Button disabled={!can('create_sale')} />
 *
 * @returns {Object} Permission utilities
 */
const usePermissions = () => {
  const user = useSelector((state) => state.auth.user);

  const role = user?.role || null;

  return {
    // Current user's role
    role,

    // Check if user has a specific permission
    can: (permission) => hasPermission(role, permission),

    // Quick role checks
    isAdmin: role === ROLES.ADMIN,
    isManager: role === ROLES.MANAGER,
    isCashier: role === ROLES.CASHIER,

    // Helpful for conditionals
    isAuthenticated: !!user,
  };
};

export default usePermissions;
