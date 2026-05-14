import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
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
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard"
        element={
          <div className="p-8 text-center text-2xl">
            Dashboard (coming soon)
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
