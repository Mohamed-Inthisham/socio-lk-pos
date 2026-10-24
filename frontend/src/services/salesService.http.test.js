import http from "node:http";
import { AxiosError } from "axios";
import api from "./api";
import { listSales, voidSale } from "./salesService";
import { colomboDayBounds } from "../utils/colomboDay";

/**
 * salesService against the real axios instance (api.js, interceptors
 * included), with nothing mocked. Requests go out through axios's
 * default adapter (XHR, as in the browser; jsdom sends it over real HTTP)
 * to a local server that records the raw request line.
 */

let server;
let requests;
let voidReply;

const send = (req, res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") return send(req, res, 204);
    requests.push({ method: req.method, url: req.url });
    if (req.method === "GET" && req.url.startsWith("/sales?")) {
      return send(req, res, 200, { data: [], meta: { total: 0 } });
    }
    if (req.method === "POST" && req.url === "/sales/sale-1/void") {
      return send(req, res, voidReply.status, voidReply.body);
    }
    return send(req, res, 404, { message: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.defaults.baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  api.defaults.baseURL = import.meta.env.VITE_API_BASE_URL;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
});

const voidPayload = {
  void_reason: "Wrong price",
  approval: { approver_id: "user-9", pin: "482915" },
};

describe("listSales on the wire", () => {
  it("sends a Colombo day's bounds URL-encoded: +05:30 as %2B05:30", async () => {
    await listSales({ branchId: "branch-1", ...colomboDayBounds("2026-10-21") });

    expect(requests).toHaveLength(1);
    const { url } = requests[0];
    expect(url).toContain("completedFrom=2026-10-21T00:00:00%2B05:30");
    expect(url).toContain("completedTo=2026-10-22T00:00:00%2B05:30");
    expect(url).not.toContain("+");

    // And the server reads the offset back, not a space.
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("completedFrom")).toBe("2026-10-21T00:00:00+05:30");
    expect(query.get("completedTo")).toBe("2026-10-22T00:00:00+05:30");
  });

  it("encodes a + in a search too (a phone number with +94)", async () => {
    await listSales({ branchId: "branch-1", q: "+94 77" });

    const { url } = requests[0];
    expect(url).toContain("q=%2B94");
    expect(new URLSearchParams(url.split("?")[1]).get("q")).toBe("+94 77");
  });
});

describe("voidSale is never resent", () => {
  it("one POST on a 500, rejected to the caller", async () => {
    voidReply = { status: 500, body: { message: "Internal server error" } };

    await expect(voidSale("sale-1", voidPayload)).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(requests).toEqual([{ method: "POST", url: "/sales/sale-1/void" }]);
  });

  it("one POST on a WRONG_PIN 403, and no token refresh", async () => {
    voidReply = {
      status: 403,
      body: { message: "Wrong PIN. 3 attempts left.", code: "WRONG_PIN", attempts_left: 3 },
    };

    await expect(voidSale("sale-1", voidPayload)).rejects.toMatchObject({
      response: { status: 403, data: { code: "WRONG_PIN", attempts_left: 3 } },
    });
    expect(requests).toEqual([{ method: "POST", url: "/sales/sale-1/void" }]);
  });

  it("one POST on a 423 PIN_LOCKED, and no token refresh", async () => {
    voidReply = {
      status: 423,
      body: { message: "Asha's PIN is locked until 2:32 PM.", code: "PIN_LOCKED" },
    };

    await expect(voidSale("sale-1", voidPayload)).rejects.toMatchObject({
      response: { status: 423 },
    });
    expect(requests).toEqual([{ method: "POST", url: "/sales/sale-1/void" }]);
  });

  describe("when no response arrives", () => {
    // A 30 s timeout can't be waited out in a unit test, so the adapter
    // (the transport) is replaced; the instance, its config and its
    // interceptors are the real ones.
    let originalAdapter;
    let calls;

    beforeEach(() => {
      originalAdapter = api.defaults.adapter;
      calls = [];
    });

    afterEach(() => {
      api.defaults.adapter = originalAdapter;
    });

    it("makes exactly one POST on a timeout and doesn't retry", async () => {
      api.defaults.adapter = async (config) => {
        calls.push({ method: config.method, url: config.url, timeout: config.timeout });
        throw new AxiosError("timeout of 30000ms exceeded", AxiosError.ECONNABORTED, config);
      };

      await expect(voidSale("sale-1", voidPayload)).rejects.toMatchObject({
        code: "ECONNABORTED",
      });
      expect(calls).toEqual([{ method: "post", url: "/sales/sale-1/void", timeout: 30000 }]);
    });

    it("makes exactly one POST on a network error and doesn't retry", async () => {
      api.defaults.adapter = async (config) => {
        calls.push({ method: config.method, url: config.url });
        throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
      };

      await expect(voidSale("sale-1", voidPayload)).rejects.toMatchObject({
        code: "ERR_NETWORK",
      });
      expect(calls).toEqual([{ method: "post", url: "/sales/sale-1/void" }]);
    });
  });
});
