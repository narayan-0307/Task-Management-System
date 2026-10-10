"use strict";

// H2 (agent side):
// - Packaged builds use credentials from the secure enrollment store.
// - AGENT_UUID / AGENT_SECRET environment variables are ignored in packaged builds.
// - Packaged builds always use the production API URL.
// - Development builds retain the existing environment-variable behavior.
//
// The secret travels only in the HTTPS request body and is never logged.

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");

const { buildConfig, validateConfig } = require("../src/config/config");
const { sendHeartbeat } = require("../src/auth/agentAuth");
const { startHeartbeatLoop, stopHeartbeatLoop } = require("../src/heartbeat");

const PRODUCTION_API_BASE_URL =
  "https://darkviolet-cobra-939760.hostingersite.com/api";

const ENV_KEYS = [
  "AGENT_API_BASE_URL",
  "AGENT_UUID",
  "AGENT_SECRET",
  "AGENT_CONFIG_PATH",
];

const ENV_CREDS = {
  AGENT_UUID: "env-uuid",
  AGENT_SECRET: "env-secret-plaintext",
};

const SECURE = {
  apiBaseUrl: "https://enrolled.example/api",
  agentUuid: "store-uuid",
  agentSecret: "store-secret",
};

function withEnv(vars, fn) {
  const saved = {};

  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  // Keep any local development config out of these tests.
  process.env.AGENT_CONFIG_PATH = path.join(
    os.tmpdir(),
    "no-such-agent-config.json",
  );

  Object.assign(process.env, vars);

  const restore = () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  };

  let r;

  try {
    r = fn();
  } catch (e) {
    restore();
    throw e;
  }

  if (r && typeof r.then === "function") {
    return r.finally(restore);
  }

  restore();
  return r;
}

// ------------------------------------------------------- credential sources

test("development: AGENT_UUID / AGENT_SECRET env vars still work (and win, as before)", () => {
  withEnv(
    {
      ...ENV_CREDS,
      AGENT_API_BASE_URL: "http://localhost:5000/api",
    },
    () => {
      const c = buildConfig(SECURE, { isPackaged: false });

      assert.equal(c.agentUuid, "env-uuid");
      assert.equal(c.agentSecret, "env-secret-plaintext");
      assert.equal(c.apiBaseUrl, "http://localhost:5000/api");

      assert.doesNotThrow(() => validateConfig(c));
    },
  );
});

test("packaged: env credentials are ignored; secure store remains the credential source", () => {
  withEnv(ENV_CREDS, () => {
    const c = buildConfig(SECURE, { isPackaged: true });

    assert.equal(c.agentUuid, "store-uuid");
    assert.equal(c.agentSecret, "store-secret");

    // Packaged API URL is pinned to production.
    assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);
  });
});

test("packaged: env credentials alone never authenticate (no secure store -> not configured)", () => {
  withEnv(
    {
      ...ENV_CREDS,
      AGENT_API_BASE_URL: "https://example.com/api",
    },
    () => {
      const c = buildConfig({}, { isPackaged: true });

      assert.equal(c.agentUuid, "");
      assert.equal(c.agentSecret, "");

      // API URL is still available because it is pinned in packaged builds.
      assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);

      assert.throws(() => validateConfig(c), /agentUuid, agentSecret/);
    },
  );
});

test("packaged: API URL is always pinned to production regardless of environment value", () => {
  withEnv(
    {
      AGENT_API_BASE_URL: "https://env.example/api",
    },
    () => {
      const c = buildConfig(SECURE, { isPackaged: true });

      assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);
      assert.equal(c.apiBaseUrlError, null);
    },
  );

  withEnv(
    {
      AGENT_API_BASE_URL: "http://env.example/api",
    },
    () => {
      const c = buildConfig(SECURE, { isPackaged: true });

      assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);
      assert.equal(c.apiBaseUrlError, null);
    },
  );
});

// --------------------------------------------- transmission + no logging

const SECRET = "s3cr3t-" + "f".repeat(57);

const CONFIG = {
  apiBaseUrl: "http://localhost:5000/api",
  agentUuid: "u-123",
  agentSecret: SECRET,
  heartbeatIntervalSeconds: 3600,
};

function capture() {
  const lines = [];
  const orig = {};

  for (const k of ["log", "info", "warn", "error"]) {
    orig[k] = console[k];

    console[k] = (...args) => lines.push(args.map(String).join(" "));
  }

  return {
    lines,
    restore: () => Object.assign(console, orig),
  };
}

function stubFetch(respond) {
  const calls = [];
  const real = global.fetch;

  global.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      init,
    });

    return respond(url, init);
  };

  return {
    calls,
    restore: () => {
      global.fetch = real;
    },
  };
}

test("the secret is sent only in the request body — never in the URL or headers", async () => {
  const f = stubFetch(() => ({
    status: 200,
    json: async () => ({
      agent: {
        agent_uuid: "u-123",
      },
    }),
  }));

  try {
    await sendHeartbeat(CONFIG);

    assert.equal(f.calls.length, 1);

    const { url, init } = f.calls[0];

    assert.ok(!url.includes(SECRET), "secret in URL");
    assert.ok(!url.includes("?"), "no query string");

    assert.ok(
      !JSON.stringify(init.headers).includes(SECRET),
      "secret in headers",
    );

    assert.equal(JSON.parse(init.body).agent_secret, SECRET);
  } finally {
    f.restore();
  }
});

test("the secret is never logged — heartbeat ok / 401 / HTTP error / network failure", async () => {
  const outcomes = [
    () => ({
      status: 200,
      json: async () => ({
        agent: {
          agent_uuid: "u-123",
          last_seen_at: "now",
        },
      }),
    }),

    () => ({
      status: 401,
      json: async () => ({
        message: "Invalid agent credentials.",
      }),
    }),

    () => ({
      status: 500,
      json: async () => ({}),
    }),

    () => {
      throw new Error("connect ECONNREFUSED");
    },
  ];

  const cap = capture();

  try {
    for (const respond of outcomes) {
      const f = stubFetch(respond);

      try {
        startHeartbeatLoop(CONFIG);

        await new Promise((r) => setTimeout(r, 30));

        stopHeartbeatLoop();

        await sendHeartbeat(CONFIG);
      } finally {
        f.restore();
      }
    }
  } finally {
    stopHeartbeatLoop();
    cap.restore();
  }

  assert.ok(cap.lines.length >= 4, "the loop logged its outcomes");

  for (const line of cap.lines) {
    assert.ok(!line.includes(SECRET), `secret logged: ${line.slice(0, 80)}`);
  }
});
