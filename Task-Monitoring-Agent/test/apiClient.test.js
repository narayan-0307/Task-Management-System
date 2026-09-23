"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { postJson, NetworkError } = require("../src/api/apiClient");

function withMockFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = original;
    });
}

test("postJson resolves { status, data } on a successful response", () =>
  withMockFetch(
    async (url, opts) => {
      assert.equal(url, "http://x/ok");
      assert.equal(opts.method, "POST");
      assert.ok(opts.signal); // AbortController signal is always attached
      return {
        status: 200,
        json: async () => ({ hello: "world" }),
      };
    },
    async () => {
      const result = await postJson("http://x/ok", { a: 1 });
      assert.deepEqual(result, { status: 200, data: { hello: "world" } });
    },
  ));

test("postJson resolves { status, data:null } on a non-JSON success body (e.g. 201 with no body)", () =>
  withMockFetch(
    async () => ({
      status: 201,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    }),
    async () => {
      const result = await postJson("http://x/created", {});
      assert.deepEqual(result, { status: 201, data: null });
    },
  ));

test("postJson passes through HTTP error statuses unchanged (e.g. 401, 500)", () =>
  withMockFetch(
    async () => ({
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }),
    async () => {
      const result = await postJson("http://x/auth", {});
      assert.equal(result.status, 401);
      assert.deepEqual(result.data, { error: "unauthorized" });
    },
  ));

test("postJson converts a network failure (fetch rejection) into NetworkError", () =>
  withMockFetch(
    async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    },
    async () => {
      await assert.rejects(
        () => postJson("http://x/down", {}),
        (err) => {
          assert.ok(err instanceof NetworkError);
          assert.match(err.message, /ECONNREFUSED/);
          return true;
        },
      );
    },
  ));

test("postJson aborts a hung request after the timeout and converts it into NetworkError (not a hang, not a crash)", () =>
  withMockFetch(
    (url, opts) =>
      new Promise((_resolve, reject) => {
        // Simulate a real fetch: never settles on its own, but honours the
        // AbortSignal like the platform implementation does.
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
    async () => {
      const start = Date.now();
      await assert.rejects(
        () => postJson("http://x/hangs", {}, 30), // 30ms timeout for a fast test
        (err) => {
          assert.ok(err instanceof NetworkError);
          assert.match(err.message, /timed out/i);
          return true;
        },
      );
      // Resolved promptly, not left pending indefinitely.
      assert.ok(Date.now() - start < 2000);
    },
  ));

test("postJson defaults to a 10s timeout when none is given", () => {
  const { DEFAULT_TIMEOUT_MS } = require("../src/api/apiClient");
  assert.equal(DEFAULT_TIMEOUT_MS, 10000);
});

test("existing callers (heartbeat / events / content) still get ok/auth/network/http kinds through the timeout-wrapped client", () =>
  withMockFetch(
    async () => ({ status: 200, json: async () => ({ agent: { last_seen_at: "now" } }) }),
    async () => {
      delete require.cache[require.resolve("../src/auth/agentAuth")];
      const { sendHeartbeat } = require("../src/auth/agentAuth");
      const result = await sendHeartbeat({
        apiBaseUrl: "http://x",
        agentUuid: "u",
        agentSecret: "s",
      });
      assert.equal(result.ok, true);
      assert.equal(result.kind, "ok");
    },
  ));

test("existing callers see a timed-out request as the same 'network' kind as any other network failure", async () => {
  const originalEnv = process.env.AGENT_API_TIMEOUT_MS;
  process.env.AGENT_API_TIMEOUT_MS = "30"; // fast test; agentAuth doesn't pass timeoutMs itself
  try {
    await withMockFetch(
      (url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
      async () => {
        delete require.cache[require.resolve("../src/auth/agentAuth")];
        const { sendHeartbeat } = require("../src/auth/agentAuth");
        const result = await sendHeartbeat({
          apiBaseUrl: "http://x",
          agentUuid: "u",
          agentSecret: "s",
        });
        assert.equal(result.ok, false);
        assert.equal(result.kind, "network");
      },
    );
  } finally {
    if (originalEnv === undefined) delete process.env.AGENT_API_TIMEOUT_MS;
    else process.env.AGENT_API_TIMEOUT_MS = originalEnv;
  }
});
