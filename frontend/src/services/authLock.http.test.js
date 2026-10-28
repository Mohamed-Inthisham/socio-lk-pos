import http from "node:http";

/**
 * Refresh and logout against a local server with strict rotation: each
 * refresh token works once, and presenting a rotated one is reuse. Each
 * "tab" is its own copy of api.js (and authService.js) — its own axios
 * instance and in-flight refresh — while jsdom's cookie jar is shared,
 * as tabs share the browser's. Nothing in api.js is mocked; only
 * navigator.locks is supplied, as an exclusive queue per lock name.
 */

let server;
let baseURL;
let state;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cookieValue = (req, name) =>
  (req.headers.cookie ?? "")
    .split(/;\s*/)
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1) || null;

const send = (req, res, status, body, cookies = []) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST",
    "Set-Cookie": cookies,
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const issue = () => {
  state.generation += 1;
  const n = state.generation;
  state.validRefresh = `t${n}`;
  state.validAccess.add(`a${n}`);
  return [`access_token=a${n}; Path=/`, `refresh_token=t${n}; Path=/`];
};

const endSession = () => {
  state.validRefresh = null;
  state.validAccess.clear();
};

// Records each auth call's token and timing, and how many overlapped.
const handleAuth = async (req, res, route, work) => {
  const entry = { route, token: cookieValue(req, "refresh_token"), start: Date.now() };
  state.active += 1;
  state.maxActive = Math.max(state.maxActive, state.active);
  try {
    await pause(40);
    const [status, body, cookies] = work(entry.token);
    entry.status = status;
    send(req, res, status, body, cookies);
  } finally {
    entry.end = Date.now();
    state.active -= 1;
    state.auth.push(entry);
  }
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") return send(req, res, 204);
    if (req.url === "/seed") {
      // Access cookie a0 is already stale; refresh cookie t0 is valid.
      state.validRefresh = "t0";
      return send(req, res, 200, {}, ["access_token=a0; Path=/", "refresh_token=t0; Path=/"]);
    }
    if (req.url === "/data") {
      const ok = state.validAccess.has(cookieValue(req, "access_token"));
      return send(req, res, ok ? 200 : 401, ok ? { ok } : { message: "Unauthorized" });
    }
    if (req.url === "/auth/refresh") {
      return handleAuth(req, res, "refresh", (token) => {
        if (token && token === state.validRefresh) {
          state.used.add(token);
          return [200, { success: true }, issue()];
        }
        if (token && state.used.has(token)) {
          endSession();
          return [401, { message: "Refresh token reuse detected" }];
        }
        return [401, { message: "No refresh token" }];
      });
    }
    if (req.url === "/auth/refresh/logout") {
      return handleAuth(req, res, "logout", (token) => {
        if (token && token === state.validRefresh) {
          state.used.add(token);
          endSession();
        }
        return [
          200,
          { success: true },
          ["access_token=; Path=/; Max-Age=0", "refresh_token=; Path=/; Max-Age=0"],
        ];
      });
    }
    return send(req, res, 404, { message: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** One exclusive queue per lock name, shared by every tab. */
const fakeWebLocks = () => {
  const queues = new Map();
  return {
    request: (name, task) => {
      const run = (queues.get(name) ?? Promise.resolve()).then(() => task());
      queues.set(
        name,
        run.catch(() => {}),
      );
      return run;
    },
  };
};

const setLocks = (locks) =>
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });

/** A fresh copy of api.js + authService.js, as another tab would load. */
const openTab = async () => {
  vi.resetModules();
  const apiModule = await import("./api");
  const authService = await import("./authService");
  apiModule.default.defaults.baseURL = baseURL;
  const onAuthFailure = vi.fn();
  apiModule.setAuthFailureHandler(onAuthFailure);
  return { api: apiModule.default, logoutAPI: authService.logoutAPI, onAuthFailure };
};

const waitFor = async (check) => {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await pause(5);
  }
};

const refreshStarted = () => state.active > 0;

beforeEach(async () => {
  state = {
    generation: 0,
    validRefresh: null,
    validAccess: new Set(),
    used: new Set(),
    auth: [],
    active: 0,
    maxActive: 0,
  };
  setLocks(undefined);
  const seeder = await openTab();
  await seeder.api.get("/seed");
});

afterEach(() => {
  setLocks(undefined);
});

describe("with Web Locks", () => {
  beforeEach(() => setLocks(fakeWebLocks()));

  it("two tabs refreshing at once: the second waits and sends the rotated cookie", async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    const [a, b] = await Promise.all([tabA.api.get("/data"), tabB.api.get("/data")]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(state.auth.map(({ route, token, status }) => ({ route, token, status }))).toEqual([
      { route: "refresh", token: "t0", status: 200 },
      { route: "refresh", token: "t1", status: 200 },
    ]);
    expect(state.maxActive).toBe(1);
    expect(tabA.onAuthFailure).not.toHaveBeenCalled();
    expect(tabB.onAuthFailure).not.toHaveBeenCalled();
  });

  it("logout in one tab waits for another tab's refresh and revokes the new token", async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    const data = tabA.api.get("/data");
    await waitFor(refreshStarted);
    await tabB.logoutAPI();
    await Promise.allSettled([data]);

    const [refresh, logout] = state.auth;
    expect(refresh).toMatchObject({ route: "refresh", token: "t0", status: 200 });
    expect(logout).toMatchObject({ route: "logout", token: "t1" });
    expect(logout.start).toBeGreaterThanOrEqual(refresh.end);
    expect(state.validRefresh).toBeNull();
  });
});

describe("without Web Locks (per-tab fallback)", () => {
  it("logout waits for this tab's refresh, and nothing restores the session after it", async () => {
    const tab = await openTab();

    const data = tab.api.get("/data");
    await waitFor(refreshStarted);
    await tab.logoutAPI();
    await Promise.allSettled([data]);

    const [refresh, logout] = state.auth;
    expect(refresh).toMatchObject({ route: "refresh", token: "t0", status: 200 });
    expect(logout).toMatchObject({ route: "logout", token: "t1" });
    expect(logout.start).toBeGreaterThanOrEqual(refresh.end);
    expect(state.validRefresh).toBeNull();

    // A later 401 finds no refresh cookie: the session stays ended.
    await expect(tab.api.get("/data")).rejects.toMatchObject({ response: { status: 401 } });
    expect(state.auth.at(-1)).toMatchObject({ route: "refresh", token: null, status: 401 });
    expect(tab.onAuthFailure).toHaveBeenCalled();
  });

  it("two tabs aren't coordinated: the server's reuse detection ends the session", async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    const results = await Promise.allSettled([tabA.api.get("/data"), tabB.api.get("/data")]);

    // Both sent t0; the second use is reuse, which ends the session.
    expect(state.auth.map(({ token }) => token)).toEqual(["t0", "t0"]);
    expect(state.auth.map(({ status }) => status).sort()).toEqual([200, 401]);
    expect(state.validRefresh).toBeNull();
    expect(results.some(({ status }) => status === "rejected")).toBe(true);
  });
});
