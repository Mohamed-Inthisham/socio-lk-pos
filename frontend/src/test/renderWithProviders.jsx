import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import authReducer from "../store/slices/authSlice";
import branchesReducer from "../store/slices/branchesSlice";
import brandsReducer from "../store/slices/brandsSlice";
import categoriesReducer from "../store/slices/categoriesSlice";
import posTerminalReducer from "../store/slices/posTerminalSlice";
import cashDayReducer from "../store/slices/cashDaySlice";

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
      posTerminal: posTerminalReducer,
      cashDay: cashDayReducer,
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

/** cashDay slice, deep-merged per part (e.g. { branchId, current: { status: "open", today } }). */
export const cashDayState = (overrides = {}) => {
  const base = cashDayReducer(undefined, { type: "@@INIT" });
  return {
    ...base,
    ...overrides,
    current: { ...base.current, ...overrides.current },
    open: { ...base.open, ...overrides.open },
    close: { ...base.close, ...overrides.close },
    pastDays: { ...base.pastDays, ...overrides.pastDays },
  };
};

/** posTerminal slice with an open draft (pass overrides, e.g. { draftSale }). */
export const posTerminalState = (overrides = {}) => {
  const base = posTerminalReducer(undefined, { type: "@@INIT" });
  const draftSale = overrides.draftSale ?? {
    id: "sale-1",
    status: "DRAFT",
    branch_id: "branch-main",
    lines: [],
    payments: [],
    subtotal: "0.00",
    discount_total: "0.00",
    total: "0.00",
  };
  return {
    ...base,
    status: "ready",
    draftSaleId: draftSale.id,
    draftSale,
    ...overrides,
  };
};
