import { vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import PhonesToCheck from ".";
import RoleProtectedRoute from "../../components/auth/RoleProtectedRoute";
import { authState, branchesState, renderWithProviders } from "../../test/renderWithProviders";
import { cashierUser, mainShop } from "../../test/fixtures";
import {
  inspectionRow,
  inspectionWrongBranchError,
  notInInspectionError,
  productUnitEntity,
  returnTimeoutError,
  unitNotFoundError,
} from "../../test/returnEntities";
import * as saleReturnsService from "../../services/saleReturnsService";
import * as productUnitsService from "../../services/productUnitsService";
import { INSPECTION_CHANGED } from "../../hooks/useInspectionCount";

vi.mock("../../services/saleReturnsService");
vi.mock("../../services/productUnitsService");

// 10:30 on Tue 3 Nov 2026 in Colombo
const NOW = new Date("2026-11-03T05:00:00.000Z");
const managerUser = { ...cashierUser, id: "user-manager", role: "manager", name: "Asha Perera" };

const phone = (i, name, returnedAt) =>
  inspectionRow({
    product_unit: { id: `unit-${i}`, imei: `35678901234560${i}`, product_name: name },
    return_id: `ret-${i}`,
    return_number: `RET-2026110${i}-0001`,
    sale_id: `sale-${i}`,
    sale_number: `INV-2026100${i}-0007`,
    returned_at: returnedAt,
  });
// Oldest first, as the server sends them
const PHONES = () => [
  phone(1, "Samsung Galaxy A15 128GB", "2026-10-25T05:10:00.000Z"), // 9 days: amber
  phone(2, "Apple iPhone 13 128GB", "2026-10-27T05:10:00.000Z"), // 7 days
  phone(3, "Redmi Note 13 256GB", "2026-11-03T03:00:00.000Z"), // today
];

const Where = () => {
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{location.pathname}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  );
};

const renderPage = (user = managerUser) =>
  renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/pos" element={<p>terminal page</p>} />
        <Route path="/pos/sales/:id" element={<p>sale detail</p>} />
        <Route
          path="/pos/inspection"
          element={
            <RoleProtectedRoute allowedRoles={["admin", "manager"]} fallbackPath="/pos">
              <PhonesToCheck />
            </RoleProtectedRoute>
          }
        />
      </Routes>
    </>,
    {
      route: "/pos/inspection",
      preloadedState: { auth: authState(user), branches: branchesState([mainShop]) },
    },
  );

const table = () => screen.getByRole("table");
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const activeRow = () => bodyRows().find((r) => r.getAttribute("aria-selected") === "true");
const ready = () => screen.findByText("Samsung Galaxy A15 128GB", { selector: "table *" });
const dialog = () => screen.getByRole("dialog");

let announced;
const onChange = (e) => announced.push(e.detail?.count);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  saleReturnsService.listInspection.mockResolvedValue(PHONES());
  announced = [];
  window.addEventListener(INSPECTION_CHANGED, onChange);
});

afterEach(() => {
  window.removeEventListener(INSPECTION_CHANGED, onChange);
  vi.useRealTimers();
});

describe("PhonesToCheck: who and what (P7-7)", () => {
  it("a cashier lands back on the terminal", async () => {
    renderPage(cashierUser);
    expect(await screen.findByText("terminal page")).toBeInTheDocument();
    expect(saleReturnsService.listInspection).not.toHaveBeenCalled();
  });

  it("lists the branch's phones oldest first, with the phone, the return and sale, and days waiting", async () => {
    renderPage();
    await ready();
    expect(saleReturnsService.listInspection).toHaveBeenCalledWith("branch-main");
    expect(screen.getByRole("heading", { name: "Phones to check · 3" })).toBeInTheDocument();

    const [first, second, third] = bodyRows();
    expect(first).toHaveTextContent("25 Oct 2026, 10:40");
    expect(first).toHaveTextContent("9 days waiting");
    expect(first).toHaveTextContent("Samsung Galaxy A15 128GB");
    expect(first).toHaveTextContent("IMEI 356789012345601");
    expect(within(first).getByRole("link", { name: "RET-20261101-0001" })).toHaveAttribute("href", "/pos/sales/sale-1");
    expect(within(first).getByRole("link", { name: "Sale INV-20261001-0007" })).toHaveAttribute("href", "/pos/sales/sale-1");
    expect(second).toHaveTextContent("7 days waiting");
    expect(third).toHaveTextContent("Returned today");
  });

  it("days waiting turn amber from 8 days", async () => {
    renderPage();
    await ready();
    const [first, second] = bodyRows();
    expect(within(first).getByTestId("days-waiting").className).toContain("amber");
    expect(within(second).getByTestId("days-waiting").className).not.toContain("amber");
  });

  it("says what to do with a faulty phone", async () => {
    renderPage();
    await ready();
    expect(screen.getByTestId("inspection-note")).toHaveTextContent(
      "Faulty: leave it here and set it aside: returning faulty phones to the supplier comes with supplier receiving.",
    );
  });

  it("tells the header how many are waiting (the list's own count)", async () => {
    renderPage();
    await ready();
    expect(announced).toEqual([3]);
  });

  it("empty, and a failed read with Try again", async () => {
    const user = userEvent.setup();
    saleReturnsService.listInspection.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce([]);
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the phones to check.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByText("No phones are waiting to be checked.")).not.toHaveLength(0);
  });
});

describe("PhonesToCheck: links and keys", () => {
  it("a link opens the sale on its Returns tab, coming back here", async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(within(bodyRows()[1]).getByRole("link", { name: "RET-20261102-0001" }));

    expect(screen.getByTestId("where")).toHaveTextContent("/pos/sales/sale-2");
    expect(JSON.parse(screen.getByTestId("state").textContent)).toEqual({
      tab: "returns",
      from: { path: "/pos/inspection", label: "Phones to check" },
    });
  });

  it("↑/↓ move the active row (oldest first), Enter opens its sale", async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    expect(activeRow()).toHaveTextContent("Samsung Galaxy A15 128GB");

    await user.keyboard("{ArrowDown}");
    expect(activeRow()).toHaveTextContent("Apple iPhone 13 128GB");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeRow()).toHaveTextContent("Redmi Note 13 256GB");
    await user.keyboard("{ArrowUp}{Enter}");

    expect(screen.getByTestId("where")).toHaveTextContent("/pos/sales/sale-2");
  });

  it("Esc goes back to the terminal", async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.keyboard("{Escape}");
    expect(screen.getByText("terminal page")).toBeInTheDocument();
  });
});

describe("PhonesToCheck: Passed: back to stock", () => {
  const confirmButton = () => within(dialog()).getByRole("button", { name: /^(Passed: back to stock|Try again)$/ });

  it("P on the active row opens the confirm, focus on Cancel; Enter there just cancels", async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.keyboard("p");

    expect(dialog()).toHaveTextContent("Samsung Galaxy A15 128GB · IMEI 356789012345601 goes back to stock and can be sold again.");
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(productUnitsService.passInspection).not.toHaveBeenCalled();
  });

  it("confirmed: one POST, the row leaves, the status line, the header count, focus to the list", async () => {
    const user = userEvent.setup();
    productUnitsService.passInspection.mockResolvedValue(productUnitEntity({ id: "unit-1" }));
    renderPage();
    await ready();
    await user.click(within(bodyRows()[0]).getByRole("button", { name: "Passed: back to stock" }));
    await user.dblClick(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(productUnitsService.passInspection).toHaveBeenCalledTimes(1);
    expect(productUnitsService.passInspection).toHaveBeenCalledWith("unit-1");
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("IMEI 356789012345601 is back in stock.");
    expect(announced).toEqual([3, 2]);
    expect(activeRow()).toHaveTextContent("Apple iPhone 13 128GB");
    await waitFor(() => expect(screen.getByLabelText("Phones to check", { selector: "div" })).toHaveFocus());
  });

  it("someone passed it just now: done, the row leaves", async () => {
    const user = userEvent.setup();
    productUnitsService.passInspection.mockRejectedValue(notInInspectionError("IN_STOCK"));
    renderPage();
    await ready();
    await user.keyboard("p");
    await user.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      "IMEI 356789012345601: Already back in stock (someone passed it just now).",
    );
    expect(bodyRows()).toHaveLength(2);
  });

  it.each([
    ["sold meanwhile", () => notInInspectionError("SOLD"), "This phone isn't waiting to be checked any more (now sold)."],
    ["another branch's", inspectionWrongBranchError, "This phone is at another branch."],
    ["gone", unitNotFoundError, "This phone no longer exists."],
  ])("%s: says so in the dialog, the confirm is disabled, focus on Cancel, the list re-read", async (_, make, message) => {
    const user = userEvent.setup();
    productUnitsService.passInspection.mockRejectedValue(make());
    renderPage();
    await ready();
    await user.keyboard("p");
    await user.click(confirmButton());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(message);
    expect(confirmButton()).toBeDisabled();
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await waitFor(() => expect(saleReturnsService.listInspection).toHaveBeenCalledTimes(2));
  });

  it("no answer, gone on re-read: it went through", async () => {
    const user = userEvent.setup();
    productUnitsService.passInspection.mockRejectedValue(returnTimeoutError());
    saleReturnsService.listInspection.mockResolvedValueOnce(PHONES()).mockResolvedValueOnce(PHONES().slice(1));
    renderPage();
    await ready();
    await user.keyboard("p");
    await user.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("IMEI 356789012345601 is back in stock.");
    expect(productUnitsService.passInspection).toHaveBeenCalledTimes(1);
  });

  it("no answer, still listed: Try again (focused) sends again", async () => {
    const user = userEvent.setup();
    productUnitsService.passInspection
      .mockRejectedValueOnce(returnTimeoutError())
      .mockResolvedValueOnce(productUnitEntity({ id: "unit-1" }));
    renderPage();
    await ready();
    await user.keyboard("p");
    await user.click(confirmButton());

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(
      "Couldn't pass it: no answer from the server. Try again.",
    );
    await waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveTextContent("Try again");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(productUnitsService.passInspection).toHaveBeenCalledTimes(2);
    expect(bodyRows()).toHaveLength(2);
  });

  it("the last phone passed: the empty list, focus to Terminal", async () => {
    const user = userEvent.setup();
    saleReturnsService.listInspection.mockResolvedValue(PHONES().slice(0, 1));
    productUnitsService.passInspection.mockResolvedValue(productUnitEntity({ id: "unit-1" }));
    renderPage();
    await ready();
    await user.keyboard("p");
    await user.click(confirmButton());

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByText("No phones are waiting to be checked.").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", { name: "Terminal" })).toHaveFocus());
  });
});
