import { Navigate } from "react-router-dom";
import usePermissions from "../../../hooks/usePermissions";

/**
 * RoleProtectedRoute Component
 *
 * Restricts route access to specific roles.
 * Use AFTER ProtectedRoute (assumes user is authenticated).
 *
 * Usage:
 *   <Route
 *     path="/users"
 *     element={
 *       <ProtectedRoute>
 *         <RoleProtectedRoute allowedRoles={['admin']}>
 *           <UsersPage />
 *         </RoleProtectedRoute>
 *       </ProtectedRoute>
 *     }
 *   />
 *
 * @param {string[]} allowedRoles - Array of role names allowed
 * @param {ReactNode} children - Protected content
 * @param {string} fallbackPath - Where to redirect if denied (default: /dashboard)
 */
const RoleProtectedRoute = ({
  allowedRoles = [],
  children,
  fallbackPath = "/dashboard",
}) => {
  const { role } = usePermissions();

  // User's role is not in the allowed list
  if (!allowedRoles.includes(role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
};

export default RoleProtectedRoute;
