import { useSelector } from "react-redux";
import { Navigate, useLocation } from "react-router-dom";

/**
 * ProtectedRoute Component
 *
 * Guards routes that require authentication.
 * Redirects unauthenticated users to login page.
 *
 * Features:
 * - Checks authentication status from Redux
 * - Remembers the attempted URL for post-login redirect
 * - Shows loading state during session restoration
 *
 * Usage:
 *   <Route
 *     path="/dashboard"
 *     element={
 *       <ProtectedRoute>
 *         <DashboardPage />
 *       </ProtectedRoute>
 *     }
 *   />
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, initialized, loading } = useSelector(
    (state) => state.auth,
  );
  const location = useLocation();

  // Wait for session restoration to complete before deciding
  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-300">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  // Pass the current location so we can redirect back after login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated - show the protected content
  return children;
};

export default ProtectedRoute;
