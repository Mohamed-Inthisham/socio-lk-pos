import { INSPECTION_ERROR, classifyInspectionError } from "./inspectionErrors";
import {
  inspectionWrongBranchError,
  notInInspectionError,
  returnNetworkError,
  returnServerError,
  returnTimeoutError,
  unitNotFoundError,
} from "../test/returnEntities";

describe("classifyInspectionError (P7-7)", () => {
  it.each([
    [
      "NOT_IN_INSPECTION, now in stock: passed by someone else",
      () => notInInspectionError("IN_STOCK"),
      { kind: INSPECTION_ERROR.ALREADY_PASSED, reread: true, done: true, retry: false, message: "Already back in stock (someone passed it just now)." },
    ],
    [
      "NOT_IN_INSPECTION, now sold",
      () => notInInspectionError("SOLD"),
      { kind: INSPECTION_ERROR.NOT_IN_INSPECTION, reread: true, done: false, retry: false, message: "This phone isn't waiting to be checked any more (now sold)." },
    ],
    [
      "NOT_IN_INSPECTION, written off",
      () => notInInspectionError("WRITTEN_OFF"),
      { kind: INSPECTION_ERROR.NOT_IN_INSPECTION, message: "This phone isn't waiting to be checked any more (now written off)." },
    ],
    [
      "INSPECTION_WRONG_BRANCH",
      inspectionWrongBranchError,
      { kind: INSPECTION_ERROR.WRONG_BRANCH, reread: true, done: false, message: "This phone is at another branch." },
    ],
    ["404", unitNotFoundError, { kind: INSPECTION_ERROR.NOT_FOUND, reread: true, message: "This phone no longer exists." }],
    [
      "a 403 without a code",
      () => Object.assign(new Error("x"), { response: { status: 403, data: { message: "Forbidden resource" } } }),
      { kind: INSPECTION_ERROR.FORBIDDEN, reread: false, message: "Only managers and admins can pass a check." },
    ],
  ])("%s", (_, make, expected) => {
    expect(classifyInspectionError(make())).toMatchObject(expected);
  });

  it.each([returnTimeoutError, returnNetworkError, returnServerError])("%o is a lost answer: re-read, then Try again", (make) => {
    expect(classifyInspectionError(make())).toEqual({
      kind: INSPECTION_ERROR.LOST,
      reread: false,
      done: false,
      retry: true,
      message: "Couldn't pass it: no answer from the server. Try again.",
    });
  });

  it("another 4xx keeps the server's message", () => {
    const error = Object.assign(new Error("x"), { response: { status: 400, data: { message: ["id must be a UUID"] } } });
    expect(classifyInspectionError(error)).toMatchObject({ kind: INSPECTION_ERROR.REJECTED, message: "id must be a UUID" });
  });
});
