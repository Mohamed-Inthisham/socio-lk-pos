import { vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import StockPurchaseDetail from "./index";
import * as stockPurchasesService from "../../services/stockPurchasesService";
import { renderWithProviders } from "../../test/renderWithProviders";

vi.mock("../../services/stockPurchasesService");

const purchase = {
  id: "purchase-1",
  purchase_number: "SP-0000ABCD",
  supplier_invoice_number: null,
  total_amount: "2000.00",
  purchase_date: "2026-11-02",
  notes: null,
  supplier: { id: "supplier-1", name: "Colombo Wholesale" },
  branch: { id: "branch-main", name: "Main Shop" },
  created_by: { id: "user-manager", full_name: "Nimal Silva" },
  items: [
    {
      id: "line-1",
      product_name_snapshot: "UGREEN Cable",
      product_sku_snapshot: "SKU-CABLE",
      quantity: 5,
      unit_buying_price: "400.00",
      unit_selling_price: null,
      line_total: "2000.00",
      imei_numbers: [],
      serial_numbers: [],
    },
  ],
  payments: [],
};

const NOTICE = "This purchase was already recorded. Showing the existing purchase.";

const renderAt = (route) =>
  renderWithProviders(
    <Routes>
      <Route path="/stock-purchases/:id" element={<StockPurchaseDetail />} />
    </Routes>,
    { route },
  );

describe("StockPurchaseDetail: already-recorded notice (Phase 1 T1c)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stockPurchasesService.getStockPurchase.mockResolvedValue(purchase);
  });

  it("shows the notice when the create page found the purchase already recorded (200)", async () => {
    renderAt({ pathname: "/stock-purchases/purchase-1", state: { alreadyRecorded: true } });

    await screen.findByRole("heading", { name: "SP-0000ABCD" });
    expect(screen.getByRole("status")).toHaveTextContent(NOTICE);
  });

  it("shows no notice for a purchase opened any other way", async () => {
    renderAt("/stock-purchases/purchase-1");

    await screen.findByRole("heading", { name: "SP-0000ABCD" });
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
