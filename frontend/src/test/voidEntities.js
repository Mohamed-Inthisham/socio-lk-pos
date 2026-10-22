/**
 * Void and approval fixtures, copied from the backend (P6 step D2).
 *
 * - GET /approvers?branchId=: [{ id, full_name }] by name
 *   (backend/src/approvals/approvals.service.ts listApprovers)
 * - POST /sales/:id/void errors, exactly as Nest sends them:
 *   - sales.service.ts voidWithApproval: NotFoundException('Sale not
 *     found'), BadRequestException(`Cannot void a ${status} sale…`),
 *     ForbiddenException({ message, code: 'VOID_WRONG_BRANCH' })
 *   - approvals.service.ts verify: ForbiddenException({ message, code })
 *     for APPROVER_*, ForbiddenException({ message, code: 'WRONG_PIN',
 *     attempts_left }), HttpException({ message, code: 'PIN_LOCKED',
 *     locked_until }, 423)
 *   - product-units.service.ts: ConflictException({ message, imei,
 *     reason, later_sale, existing_unit }); stock.service.ts V7:
 *     ConflictException(string)
 *   Exception(string) bodies are { statusCode, message, error };
 *   Exception(object) bodies are the object as given.
 * - 200: the hydrated VOIDED sale (voidedSaleEntity in saleEntities.js).
 *
 * Every error carries the request body on `config`, as axios does: it
 * holds the PIN, which is why nothing may log or keep the error.
 */

export const approversResponse = (approvers) =>
  approvers ?? [
    { id: "user-admin", full_name: "Ruwan Fernando" },
    { id: "user-manager", full_name: "Asha Perera" },
  ].sort((a, b) => a.full_name.localeCompare(b.full_name));

const VOID_BODY = JSON.stringify({
  void_reason: "Wrong price",
  approval: { approver_id: "user-manager", pin: "482915" },
});

const axiosError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    config: { data: VOID_BODY },
  });

export const saleNotFoundError = () =>
  axiosError(404, { statusCode: 404, message: "Sale not found", error: "Not Found" });

export const notCompletedError = (status = "VOIDED") =>
  axiosError(400, {
    statusCode: 400,
    message: `Cannot void a ${status} sale. Only COMPLETED sales can be voided.`,
    error: "Bad Request",
  });

export const voidValidationError = () =>
  axiosError(400, { statusCode: 400, message: ["pin must be exactly 6 digits"], error: "Bad Request" });

export const voidWrongBranchError = () =>
  axiosError(403, { message: "You can only void sales at your own branch.", code: "VOID_WRONG_BRANCH" });

const APPROVER_MESSAGES = {
  APPROVER_NOT_FOUND: () => "Approval failed: approver not found.",
  APPROVER_INACTIVE: (name) => `${name} can't approve: their account is inactive.`,
  APPROVER_NOT_MANAGER: (name) => `${name} can't approve: only managers and admins can.`,
  APPROVER_WRONG_BRANCH: (name) => `${name} can only approve for their own branch.`,
  APPROVER_NO_PIN: (name) => `${name} has no approval PIN set.`,
};

export const approverRefusedError = (code, name = "Asha Perera") =>
  axiosError(403, { message: APPROVER_MESSAGES[code](name), code });

export const wrongPinError = (attemptsLeft = 4) =>
  axiosError(403, {
    message: `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`,
    code: "WRONG_PIN",
    attempts_left: attemptsLeft,
  });

/** 423; the 5th wrong PIN in a row prefixes "Wrong PIN. " */
export const pinLockedError = ({ name = "Asha Perera", until = "2026-10-22T09:02:00.000Z", fifth = false } = {}) =>
  axiosError(423, {
    message: `${fifth ? "Wrong PIN. " : ""}${name}'s PIN is locked until 14:32.`,
    code: "PIN_LOCKED",
    locked_until: until,
  });

const unit = (status) => ({ id: "unit-9", status, product_id: "p-used-ip12", branch_id: "branch-main" });

export const resoldError = () =>
  axiosError(409, {
    message:
      "Cannot void this sale: trade-in phone (IMEI '354789102345678') has been resold in a subsequent sale. Void the subsequent sale first, or contact an administrator.",
    imei: "354789102345678",
    reason: "RESOLD",
    later_sale: { id: "sale-12", sale_number: "INV-20261022-0012" },
    existing_unit: unit("SOLD"),
  });

export const takenBackOnSaleError = () =>
  axiosError(409, {
    message:
      "Cannot void this sale: the phone (IMEI '356789012345671') was taken back into stock on a later sale or purchase. Void that sale first, or contact an administrator.",
    imei: "356789012345671",
    reason: "TAKEN_BACK_ON_SALE",
    later_sale: { id: "sale-15", sale_number: "INV-20261022-0015" },
    existing_unit: unit("IN_STOCK"),
  });

export const boughtBackError = () =>
  axiosError(409, {
    message: "This sale can't be voided: the phone (IMEI 356789012345671) was bought back on a later purchase.",
    imei: "356789012345671",
    reason: "BOUGHT_BACK_ON_PURCHASE",
    later_sale: null,
    existing_unit: unit("IN_STOCK"),
  });

export const takenBackRaceError = () =>
  axiosError(409, {
    message:
      "Cannot void this sale: the phone (IMEI '356789012345671') was taken back into stock on a later sale or purchase. Void that sale first, or contact an administrator.",
    imei: "356789012345671",
    reason: null,
    later_sale: null,
    existing_unit: null,
  });

export const integrityConflictError = () =>
  axiosError(409, {
    statusCode: 409,
    message:
      "Insufficient stock for voided trade-in at product p-used-ip12, branch branch-main: requested 1, available 0. This indicates a data integrity issue — a trade-in intake should have left this stock row incrementable-then-decrementable.",
    error: "Conflict",
  });

export const serverError = () =>
  axiosError(500, { statusCode: 500, message: "Internal server error" });

export const voidTimeoutError = () =>
  Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED", config: { data: VOID_BODY } });

export const voidNetworkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", config: { data: VOID_BODY } });
