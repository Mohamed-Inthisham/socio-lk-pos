import { vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdjustStockDialog from "./index";
import api from "../../../services/api";

// The real stockService, with only the HTTP client mocked: checks the
// request body that leaves the browser, not just what the dialog passes
// to the service (AdjustStockDialog.test.jsx mocks the service).
vi.mock("../../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const stockRow = {
  id: "stock-1",
  quantity: 10,
  min_quantity: 3,
  manage_stock: true,
  branch: { name: "Main Shop" },
};

const openDialog = () => {
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  render(<AdjustStockDialog open onClose={vi.fn()} onSuccess={onSuccess} stockRow={stockRow} />);
  return { user, onSuccess, dialog: screen.getByRole("dialog", { name: "Adjust stock" }) };
};

const setField = async (user, dialog, label, value) => {
  const input = within(dialog).getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
};

describe("AdjustStockDialog: the request sent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.patch.mockResolvedValue({ data: { ...stockRow } });
  });

  it("PATCH /stock/:id carries the new quantity and the quantity it was based on", async () => {
    const { user, dialog, onSuccess } = openDialog();

    await setField(user, dialog, /New quantity/, "7");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith("/stock/stock-1", {
      quantity: 7,
      expected_quantity: 10,
      min_quantity: 3,
    });
  });

  it("PATCH /stock/:id leaves out quantity and expected_quantity when the quantity is unchanged", async () => {
    const { user, dialog, onSuccess } = openDialog();

    await setField(user, dialog, /Minimum quantity/, "5");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith("/stock/stock-1", { min_quantity: 5 });
    const [, body] = api.patch.mock.calls[0];
    expect(body).not.toHaveProperty("quantity");
    expect(body).not.toHaveProperty("expected_quantity");
  });
});
