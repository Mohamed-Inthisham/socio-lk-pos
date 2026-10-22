import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import PinField from ".";

const Host = ({ error }) => {
  const { register } = useForm({ defaultValues: { pin: "" } });
  return <PinField id="pin" label="Approval PIN" error={error} registration={register("pin")} />;
};

const field = () => screen.getByLabelText("Approval PIN");
const hint = () => {
  const id = field().getAttribute("aria-describedby");
  return id?.endsWith("-hint") ? document.getElementById(id) : null;
};

describe("PinField (shared by ApprovalPinDialog and ManagerApprovalFields)", () => {
  it("is a masked, numeric, 6-character one-time-code field, never a saved-password field", () => {
    render(<Host />);
    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    // Not "off": Chrome ignores it and filled the saved password (real-Chrome check, P6 fix)
    expect(field()).toHaveAttribute("autocomplete", "one-time-code");
    expect(field()).toHaveAttribute("data-lpignore", "true");
    expect(field()).toHaveAttribute("data-1p-ignore");
    expect(field()).toHaveAttribute("data-form-type", "other");
    expect(field()).toHaveAttribute("maxlength", "6");
  });

  it("opens empty, with no hint", () => {
    render(<Host />);
    expect(field()).toHaveValue("");
    expect(hint()).toBeNull();
    expect(screen.queryByText("Digits only")).not.toBeInTheDocument();
  });

  it("a fill that isn't the user (no input type, as autofill sends) is cleared and shows no hint", () => {
    render(<Host />);

    // An input event without a user inputType, as a browser autofill or extension sends
    fireEvent.input(field(), { target: { value: "HarnessPass1" } });
    expect(field()).toHaveValue("");
    expect(hint()).toBeNull();

    fireEvent.input(field(), { target: { value: "482915" }, inputType: "insertReplacementText" });
    expect(field()).toHaveValue("");
    expect(hint()).toBeNull();
  });

  it("key by key: digits kept, a letter dropped with a hint, the hint cleared by the next digit, a 7th digit ignored", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.type(field(), "4a");
    expect(field()).toHaveValue("4");
    expect(hint()).toHaveTextContent("Digits only");

    await user.type(field(), "82915");
    expect(hint()).toBeNull();
    await user.type(field(), "7");
    expect(field()).toHaveValue("482915");
  });

  it("converts other scripts' digits", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), "෪௮２९١1");
    expect(field()).toHaveValue("482911");
  });

  it("filters a paste before cutting it to 6", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(field());
    await user.paste("12a3456");
    expect(field()).toHaveValue("123456");
    expect(hint()).toHaveTextContent("Digits only");
  });

  it("an error replaces the hint, linked to the field", () => {
    render(<Host error="Wrong PIN. 4 attempts left." />);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Wrong PIN. 4 attempts left.").id).toBe(field().getAttribute("aria-describedby"));
  });
});
