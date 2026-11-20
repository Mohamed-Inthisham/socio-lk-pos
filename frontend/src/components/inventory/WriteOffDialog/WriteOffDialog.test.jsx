import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WriteOffDialog from "./index";
import * as stockService from "../../../services/stockService";
import * as productUnitsService from "../../../services/productUnitsService";

vi.mock("../../../services/stockService");
vi.mock("../../../services/productUnitsService");

const stockRow = {
  id: "stock-1",
  quantity: 8,
  manage_stock: true,
  branch: { name: "Main" },
};

describe("WriteOffDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires explicit confirmation and sends the expected quantity and reason", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    stockService.writeOffStock.mockResolvedValue({ id: "stock-1" });
    render(
      <WriteOffDialog
        open
        onClose={vi.fn()}
        onSuccess={onSuccess}
        stockRow={stockRow}
        product={{ name: "Cable" }}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Write off stock" });

    await user.selectOptions(
      within(dialog).getByLabelText(/reason/i),
      "DAMAGED",
    );
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm write-off" }),
    );

    await waitFor(() =>
      expect(stockService.writeOffStock).toHaveBeenCalledWith("stock-1", {
        quantity: 1,
        expected_quantity: 8,
        reasonCode: "DAMAGED",
      }),
    );
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("requires an explanation for Other", async () => {
    const user = userEvent.setup();
    render(
      <WriteOffDialog
        open
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        unit={{ id: "unit-1", status: "IN_STOCK" }}
        product={{ name: "Phone" }}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Write off stock" });
    await user.selectOptions(within(dialog).getByLabelText(/reason/i), "OTHER");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm write-off" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Explain the Other reason",
    );
    expect(productUnitsService.writeOffProductUnit).not.toHaveBeenCalled();
  });
});
