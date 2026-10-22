import { filterPinInput, isWeakPin, pinDigits } from "./pin";

// The 20 PINs the backend refuses (backend/src/approvals/weak-pin.ts).
const WEAK = [
  ...Array.from({ length: 10 }, (_, d) => String(d).repeat(6)),
  "012345", "123456", "234567", "345678", "456789",
  "543210", "654321", "765432", "876543", "987654",
];

describe("isWeakPin (P6-15, mirrors weak-pin.ts)", () => {
  it("refuses exactly the 20 weak PINs", () => {
    expect(WEAK).toHaveLength(20);
    for (const pin of WEAK) expect(isWeakPin(pin)).toBe(true);
  });

  it("finds no other weak PIN among all 1,000,000", () => {
    let count = 0;
    for (let n = 0; n < 1_000_000; n++) {
      if (isWeakPin(String(n).padStart(6, "0"))) count++;
    }
    expect(count).toBe(20);
  });

  it.each(["890123", "135791", "210987", "112233", "482915", "012346", "123465"])(
    "allows %s",
    (pin) => {
      expect(isWeakPin(pin)).toBe(false);
    },
  );

  it.each(["12345", "1234567", "12345a", ""])("isn't weak when it isn't a PIN at all (%j)", (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });
});

describe("pinDigits", () => {
  it("keeps digits only, at most 6", () => {
    expect(pinDigits("48 29-15")).toBe("482915");
    expect(pinDigits("4829157")).toBe("482915");
    expect(pinDigits("abc")).toBe("");
    expect(pinDigits(null)).toBe("");
  });
});

describe("filterPinInput: other scripts' digits become 0–9", () => {
  it.each([
    ["full-width", "４８２９１５"],
    ["Sinhala Lith", "෪෮෨෯෧෫"],
    ["Tamil", "௪௮௨௯௧௫"],
    ["Devanagari", "४८२९१५"],
    ["Arabic-Indic", "٤٨٢٩١٥"],
    ["Extended Arabic-Indic", "۴۸۲۹۱۵"],
  ])("%s digits → 482915, nothing dropped", (_, typed) => {
    expect(filterPinInput(typed)).toEqual({ value: "482915", dropped: false });
  });

  it("converts 0 and 9 at each set's edges", () => {
    expect(filterPinInput("０９෦෯௦௯").value).toBe("090909");
  });

  it("mixes scripts", () => {
    expect(filterPinInput("4８෨௯1٥").value).toBe("482915");
  });
});

describe("filterPinInput: what gets dropped", () => {
  it("drops letters, symbols and spaces, and says so", () => {
    expect(filterPinInput("12a3456")).toEqual({ value: "123456", dropped: true });
    expect(filterPinInput("'(é\"ç")).toEqual({ value: "", dropped: true });
    expect(filterPinInput("48 29")).toEqual({ value: "4829", dropped: true });
  });

  it("doesn't count digits past the 6th as dropped (maxLength's job)", () => {
    expect(filterPinInput("4829157")).toEqual({ value: "482915", dropped: false });
  });

  it("treats Sinhala letters (not digits) as dropped", () => {
    expect(filterPinInput("අආ")).toEqual({ value: "", dropped: true });
  });

  it("is empty and not dropped for nothing", () => {
    expect(filterPinInput("")).toEqual({ value: "", dropped: false });
    expect(filterPinInput(null)).toEqual({ value: "", dropped: false });
  });
});
