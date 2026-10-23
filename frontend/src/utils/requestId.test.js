import { newClientRequestId, uuidFromRandomValues } from "./requestId";

// The backend's @IsUUID() (class-validator, any version) accepts these.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newClientRequestId (P7-15)", () => {
  it("is a v4 uuid, new each time", () => {
    const a = newClientRequestId();
    const b = newClientRequestId();

    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it("falls back to getRandomValues where randomUUID is missing (plain http)", () => {
    const insecure = { getRandomValues: (array) => globalThis.crypto.getRandomValues(array) };

    expect(newClientRequestId(insecure)).toMatch(UUID_V4);
  });

  it("sets the version and variant bits on any random bytes", () => {
    const allOnes = { getRandomValues: (array) => array.fill(0xff) };
    const allZeros = { getRandomValues: (array) => array.fill(0) };

    expect(uuidFromRandomValues(allOnes)).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidFromRandomValues(allZeros)).toBe("00000000-0000-4000-8000-000000000000");
  });
});
