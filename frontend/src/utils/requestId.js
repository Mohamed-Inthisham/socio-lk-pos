/**
 * Client request ids (planning doc P7-15)
 *
 * The ReturnDialog makes one id when it opens and sends it with every
 * attempt from that dialog, so a resend after a lost response finds the
 * return already recorded instead of making a second one. A new id is
 * made only when the dialog opens: never on a refusal, a form edit or
 * Try again.
 *
 * crypto.randomUUID exists only in a secure context (https or
 * localhost); the tills use https (pos-till-setup.md), and a v4 uuid from
 * crypto.getRandomValues covers a till ever served over plain http.
 */

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A random v4 uuid (RFC 4122) from getRandomValues. */
export const uuidFromRandomValues = (cryptoApi = globalThis.crypto) => {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** A new client_request_id. */
export const newClientRequestId = (cryptoApi = globalThis.crypto) =>
  typeof cryptoApi.randomUUID === "function" ? cryptoApi.randomUUID() : uuidFromRandomValues(cryptoApi);
