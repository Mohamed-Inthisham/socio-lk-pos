import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WriteOffDialog from "./index";
import * as stockService from "../../../services/stockService";
import * as productUnitsService from "../../../services/productUnitsService";
import { newClientRequestId } from "../../../utils/requestId";

vi.mock("../../../services/stockService");
vi.mock("../../../services/productUnitsService");
vi.mock("../../../utils/requestId", () => ({ newClientRequestId: vi.fn() }));

const stockRow = {
  id: "stock-1",
  quantity: 8,
  manage_stock: true,
  branch: { name: "Main" },
};

describe("WriteOffDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    newClientRequestId.mockReturnValue("request-1");
  });

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
        client_request_id: "request-1",
      }),
    );
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("reuses the request ID when retrying the same operation after an ambiguous failure", async () => {
    const user = userEvent.setup();
    stockService.writeOffStock.mockRejectedValueOnce(new Error("Network timeout"));
    stockService.writeOffStock.mockResolvedValueOnce({ id: "stock-1" });
    render(<WriteOffDialog open onClose={vi.fn()} onSuccess={vi.fn()} stockRow={stockRow} product={{ name: "Cable" }} />);
    const dialog = screen.getByRole("dialog", { name: "Write off stock" });
    await user.selectOptions(within(dialog).getByLabelText(/reason/i), "DAMAGED");
    await user.click(within(dialog).getByRole("checkbox"));
    const submit = within(dialog).getByRole("button", { name: "Confirm write-off" });
    await user.click(submit);
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Could not write off this stock"));
    await user.click(submit);
    await waitFor(() => expect(stockService.writeOffStock).toHaveBeenCalledTimes(2));
    expect(stockService.writeOffStock.mock.calls[0][1].client_request_id).toBe("request-1");
    expect(stockService.writeOffStock.mock.calls[1][1].client_request_id).toBe("request-1");
    expect(newClientRequestId).toHaveBeenCalledOnce();
  });

  it("does not refresh stock for unrelated errors", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    stockService.writeOffStock.mockRejectedValueOnce({ response: { status: 500, data: { message: "Internal server error" } } });
    render(<WriteOffDialog open onClose={vi.fn()} onSuccess={vi.fn()} onStaleQuantity={refresh} stockRow={stockRow} product={{ name: "Cable" }} />);
    const dialog = screen.getByRole("dialog", { name: "Write off stock" });
    await user.selectOptions(within(dialog).getByLabelText(/reason/i), "DAMAGED");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Confirm write-off" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Internal server error");
    expect(refresh).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/quantity to write off/i)).toHaveAttribute("max", "8");
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
