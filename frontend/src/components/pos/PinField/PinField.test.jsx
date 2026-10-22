import { render, screen } from "@testing-library/react";
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
  it("is a masked, numeric, 6-character field with no autocomplete", () => {
    render(<Host />);
    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("inputmode", "numeric");
    expect(field()).toHaveAttribute("autocomplete", "off");
    expect(field()).toHaveAttribute("maxlength", "6");
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
