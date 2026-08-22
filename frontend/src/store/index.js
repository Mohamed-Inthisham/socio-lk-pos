import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import branchesReducer from "./slices/branchesSlice";
import brandsReducer from "./slices/brandsSlice";
import categoriesReducer from "./slices/categoriesSlice";

/**
 * Redux Store Configuration
 *
 * This is the central state management hub of the application.
 * All global state (auth, products, cart, etc.) is managed here.
 *
 * Features:
 * - Auto-configured with Redux DevTools support
 * - Built-in middleware for async actions (thunk)
 * - Immutability checks in development mode
 * - Serializability checks for state
 */
export const store = configureStore({
  reducer: {
    auth: authReducer,
    branches: branchesReducer,
    // Future slices will be added here:
    // products: productsReducer,
    // cart: cartReducer,
    brands: brandsReducer,
    categories: categoriesReducer,
  },

  // Development tools (auto-enabled in dev, disabled in production)
  devTools: import.meta.env.MODE !== "production",
});

// Log store creation in development
if (import.meta.env.MODE === "development") {
  console.log("🏪 Redux Store initialized");
}
