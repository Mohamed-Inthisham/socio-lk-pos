/**
 * Inspection-pass errors (planning doc P7-7, returns.md)
 *
 * Turns a failed POST /product-units/:id/inspection-pass into what the
 * Phones to check screen shows. Read by status and the body's `code`,
 * never by matching the message.
 *
 * Result: { kind, message, reread, done, retry }
 * - message: what the dialog shows
 * - reread: the list is out of date; read it again
 * - done: the phone is back in stock after all (passed just now by
 *   someone else): the confirm closes as for a pass
 * - retry: a lost response, a timeout or a 5xx: the caller re-reads the
 *   list first; a phone no longer on it went through. Resending is safe:
 *   a pass that already went through answers NOT_IN_INSPECTION, IN_STOCK
 */

export const INSPECTION_ERROR = {
  ALREADY_PASSED: "already_passed", // 409 NOT_IN_INSPECTION, status IN_STOCK
  NOT_IN_INSPECTION: "not_in_inspection", // 409 NOT_IN_INSPECTION, any other status
  WRONG_BRANCH: "wrong_branch", // 403 INSPECTION_WRONG_BRANCH
  NOT_FOUND: "not_found", // 404
  FORBIDDEN: "forbidden", // 403 without a code (a cashier)
  LOST: "lost", // no response, a timeout, a 5xx
  REJECTED: "rejected", // anything else
};

const STATUS_WORDS = {
  SOLD: "sold",
  RETURNED: "returned to its seller",
  WRITTEN_OFF: "written off",
};

const base = { reread: false, done: false, retry: false };

/**
 * @param {unknown} error - the axios error from passInspection
 */
export const classifyInspectionError = (error) => {
  const response = error?.response;
  if (!response || response.status >= 500) {
    return {
      ...base,
      kind: INSPECTION_ERROR.LOST,
      retry: true,
      message: "Couldn't pass it: no answer from the server. Try again.",
    };
  }
  const { status, data } = response;
  if (status === 409 && data?.code === "NOT_IN_INSPECTION") {
    if (data.status === "IN_STOCK") {
      return {
        ...base,
        kind: INSPECTION_ERROR.ALREADY_PASSED,
        reread: true,
        done: true,
        message: "Already back in stock (someone passed it just now).",
      };
    }
    const now = STATUS_WORDS[data.status] ?? String(data.status ?? "").toLowerCase();
    return {
      ...base,
      kind: INSPECTION_ERROR.NOT_IN_INSPECTION,
      reread: true,
      message: `This phone isn't waiting to be checked any more${now ? ` (now ${now})` : ""}.`,
    };
  }
  if (status === 403 && data?.code === "INSPECTION_WRONG_BRANCH") {
    return { ...base, kind: INSPECTION_ERROR.WRONG_BRANCH, reread: true, message: "This phone is at another branch." };
  }
  if (status === 404) {
    return { ...base, kind: INSPECTION_ERROR.NOT_FOUND, reread: true, message: "This phone no longer exists." };
  }
  if (status === 403) {
    return { ...base, kind: INSPECTION_ERROR.FORBIDDEN, message: "Only managers and admins can pass a check." };
  }
  const raw = data?.message;
  return {
    ...base,
    kind: INSPECTION_ERROR.REJECTED,
    message: (Array.isArray(raw) ? raw[0] : raw) || "Couldn't pass the phone.",
  };
};
