import { formatSlPhone, normalizeSlPhone } from "./phone";

describe("phone utils", () => {
  it.each([
    ["0771234567", "0771234567"],
    ["+94771234567", "0771234567"],
    ["94771234567", "0771234567"],
    ["077-123 4567", "0771234567"],
    ["0112345678", "0112345678"],
    ["0071234567", null],
    ["077123456", null],
    ["", null],
  ])("normalizes %j to %j (backend rule)", (input, expected) => {
    expect(normalizeSlPhone(input)).toBe(expected);
  });

  it("formats a phone for display and passes through anything else", () => {
    expect(formatSlPhone("+94771234567")).toBe("077 123 4567");
    expect(formatSlPhone("12345")).toBe("12345");
  });
});
