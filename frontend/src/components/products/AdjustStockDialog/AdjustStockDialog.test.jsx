import { vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdjustStockDialog from "./index";
import * as stockService from "../../../services/stockService";

vi.mock("../../../services/stockService");

const stockRow = {
  id: "stock-1",
  quantity: 10,
  min_quantity: 3,
  manage_stock: true,
  branch: { name: "Main Shop" },
};

const setup = (onSuccess = vi.fn()) => {
  const user = userEvent.setup();
  render(<AdjustStockDialog open onClose={vi.fn()} onSuccess={onSuccess} stockRow={stockRow} />);
  const dialog = screen.getByRole("dialog", { name: "Adjust stock" });
  return { user, dialog, onSuccess };
};

const setField = async (user, dialog, label, value) => {
  const input = within(dialog).getByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
};
const save = (user, dialog) => user.click(within(dialog).getByRole("button", { name: "Save changes" }));
const current = (dialog) => within(dialog).getByText("Currently in stock").nextElementSibling;

const staleConflict = (currentQuantity) =>
  Object.assign(new Error("Request failed with status code 409"), {
    response: {
      status: 409,
      data: {
        message: `The stock for this product changed to ${currentQuantity} while you were editing. Check the new quantity and save again.`,
        code: "STOCK_QUANTITY_CHANGED",
        stock_id: "stock-1",
        expected_quantity: 10,
        current_quantity: currentQuantity,
      },
    },
  });

describe("AdjustStockDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends the new quantity with the quantity it was based on", async () => {
    stockService.updateStock.mockResolvedValue({});
    const { user, dialog, onSuccess } = setup();

    await setField(user, dialog, /New quantity/, "7");
    await save(user, dialog);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(stockService.updateStock).toHaveBeenCalledWith("stock-1", {
      quantity: 7,
      expected_quantity: 10,
      min_quantity: 3,
    });
  });

  it("doesn't send the quantity when only the minimum changed", async () => {
    stockService.updateStock.mockResolvedValue({});
    const { user, dialog } = setup();

    await setField(user, dialog, /Minimum quantity/, "5");
    await save(user, dialog);

    await waitFor(() => expect(stockService.updateStock).toHaveBeenCalledWith("stock-1", { min_quantity: 5 }));
  });

  it("on a stale quantity keeps the typed value, shows the new stock and checks the next save against it", async () => {
    stockService.updateStock.mockRejectedValueOnce(staleConflict(8)).mockResolvedValueOnce({});
    const { user, dialog, onSuccess } = setup();
    expect(current(dialog)).toHaveTextContent("10");

    await setField(user, dialog, /New quantity/, "7");
    await save(user, dialog);

    expect(await within(dialog).findByText(/changed to 8 while you were editing/)).toBeInTheDocument();
    expect(current(dialog)).toHaveTextContent("8");
    expect(within(dialog).getByLabelText(/New quantity/)).toHaveValue(7);
    expect(within(dialog).getByText("Removing 1 unit")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();

    await save(user, dialog);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(stockService.updateStock).toHaveBeenLastCalledWith("stock-1", {
      quantity: 7,
      expected_quantity: 8,
      min_quantity: 3,
    });
  });

  it("shows other errors without changing the current quantity", async () => {
    stockService.updateStock.mockRejectedValueOnce(
      Object.assign(new Error("x"), { response: { status: 403, data: { message: "Forbidden resource" } } }),
    );
    const { user, dialog, onSuccess } = setup();

    await setField(user, dialog, /New quantity/, "7");
    await save(user, dialog);

    expect(await within(dialog).findByText("Forbidden resource")).toBeInTheDocument();
    expect(current(dialog)).toHaveTextContent("10");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
