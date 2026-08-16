import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardDemo from "./pages/DashboardDemo";
import ProductsList from "./pages/ProductsList";
import ProductDetail from "./pages/ProductDetail";
import ProductCreate from "./pages/ProductCreate";
import RoleProtectedRoute from "./components/auth/RoleProtectedRoute";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import { restoreSession } from "./store/slices/authSlice";

function App() {
  const dispatch = useDispatch();
  const { initialized, loading } = useSelector((state) => state.auth);

  // Try to restore session from localStorage on app load
  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  // Show loading screen while checking localStorage
  if (!initialized && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-300">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Default route - redirects to dashboard (or login if not authenticated) */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardDemo />
          </ProtectedRoute>
        }
      />

      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <ProductsList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/products/:id"
        element={
          <ProtectedRoute>
            <ProductDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/products/new"
        element={
          <ProtectedRoute>
            <RoleProtectedRoute allowedRoles={["admin"]}>
              <ProductCreate />
            </RoleProtectedRoute>
          </ProtectedRoute>
        }
      />

      {/* 404 fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
