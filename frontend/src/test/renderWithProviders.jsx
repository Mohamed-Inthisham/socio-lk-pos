import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import authReducer from "../store/slices/authSlice";
import branchesReducer from "../store/slices/branchesSlice";
import brandsReducer from "../store/slices/brandsSlice";
import categoriesReducer from "../store/slices/categoriesSlice";

/**
 * Test helpers: a fresh Redux store per test, plus a MemoryRouter.
 * Pass full slice objects in preloadedState (use the builders below).
 */

export const createTestStore = (preloadedState) =>
  configureStore({
    reducer: {
      auth: authReducer,
      branches: branchesReducer,
      brands: brandsReducer,
      categories: categoriesReducer,
    },
    preloadedState,
  });

export const authState = (user) => ({
  user,
  isAuthenticated: !!user,
  loading: false,
  error: null,
  initialized: true,
});

export const branchesState = (branches = [], overrides = {}) => ({
  branches,
  loading: false,
  error: null,
  initialized: true,
  ...overrides,
});

export const renderWithProviders = (
  ui,
  { preloadedState, route = "/", store = createTestStore(preloadedState) } = {},
) => ({
  store,
  ...render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </Provider>,
  ),
});
