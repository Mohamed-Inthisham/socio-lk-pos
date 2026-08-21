import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardDemo from "./pages/DashboardDemo";
import ProductsList from "./pages/ProductsList";
import ProductDetail from "./pages/ProductDetail";
import ProductCreate from "./pages/ProductCreate";
import ProductEdit from "./pages/ProductEdit";
import ManageBrands from "./pages/ManageBrands";
import ManageCategories from "./pages/ManageCategories";
import RoleProtectedRoute from "./components/auth/RoleProtectedRoute";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import { restoreSession } from "./store/slices/authSlice";

function App() {
  const dispatch = useDispatch();
  const { initialized, loading } = useSelector((state) => state.auth);

  // Try to restore session on app load — hits /auth/me via cookies.
  // If valid, populates auth state; if 401, silently marks as logged out.
  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  // Guard against browser back-forward cache (bfcache) restoring an
  // authenticated page after logout.
  //
  // Browsers cache the FROZEN DOM of pages when the user navigates away.
  // On Back, they restore the cached page without re-running React. That
  // means a logged-out user pressing Back could briefly see the previous
  // logged-in page — a real data leak on shared devices.
  //
  // On pageshow with event.persisted=true, the page came from bfcache.
  // We force a full reload so ProtectedRoute runs and redirects to login.
  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  // Show loading screen while restoring session
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
      {/* Public routes — no layout, standalone pages */}
      <Route path="/login" element={<LoginPage />} />

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/*
        Protected routes wrapped in AppLayout.
        The parent route's element is <ProtectedRoute><AppLayout /></ProtectedRoute>,
        and AppLayout contains an <Outlet /> where each child route's element
        renders. Child routes inherit the AppLayout shell (header + sidebar)
        automatically — no need to wrap each one.
      */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardDemo />} />
        <Route path="/products" element={<ProductsList />} />

        {/*
          IMPORTANT: /products/new MUST be defined before /products/:id.
          Otherwise React Router matches "new" as a UUID param and renders
          ProductDetail with id="new".
        */}
        <Route
          path="/products/new"
          element={
            <RoleProtectedRoute allowedRoles={["admin"]}>
              <ProductCreate />
            </RoleProtectedRoute>
          }
        />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route
          path="/products/:id/edit"
          element={
            <RoleProtectedRoute allowedRoles={["admin"]}>
              <ProductEdit />
            </RoleProtectedRoute>
          }
        />

        <Route path="/brands" element={<ManageBrands />} />
        <Route path="/categories" element={<ManageCategories />} />
      </Route>

      {/* 404 fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
