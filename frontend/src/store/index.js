import { configureStore } from "@reduxjs/toolkit";

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
    // Slices will be added here as we build features
    // Example: auth: authReducer,
  },

  // Development tools (auto-enabled in dev, disabled in production)
  devTools: import.meta.env.MODE !== "production",
});

// Log store creation in development
if (import.meta.env.MODE === "development") {
  console.log("🏪 Redux Store initialized");
}
