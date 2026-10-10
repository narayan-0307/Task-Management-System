"use strict";

// C1 + packaged configuration policy:
//
// - agent.config.json is development-only.
// - Packaged builds never read agent.config.json.
// - Packaged builds always use PRODUCTION_API_BASE_URL.
// - Packaged credentials come from the enrollment secure store.
// - Environment variables cannot override packaged API URL or credentials.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { minimatch } = require("minimatch");

const {
  buildConfig,
  validateConfig,
  isPackagedApp,
} = require("../src/config/config");

const PRODUCTION_API_BASE_URL =
  "https://darkviolet-cobra-939760.hostingersite.com/api";

const CRED_ENV = [
  "AGENT_API_BASE_URL",
  "AGENT_UUID",
  "AGENT_SECRET",
  "AGENT_CONFIG_PATH",
];

const FILE_CREDS = {
  apiBaseUrl: "http://dev-file.example/api",
  agentUuid: "file-uuid-0000",
  agentSecret: "file-secret-must-never-be-used-when-packaged",
};

function withFileConfig(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cfg-"));

  const file = path.join(dir, "agent.config.json");

  fs.writeFileSync(file, JSON.stringify(FILE_CREDS));

  const saved = {};

  for (const k of CRED_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }

  process.env.AGENT_CONFIG_PATH = file;

  const cleanup = () => {
    for (const k of CRED_ENV) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }

    fs.rmSync(dir, {
      recursive: true,
      force: true,
    });
  };

  let result;

  try {
    result = fn(file);
  } catch (err) {
    cleanup();
    throw err;
  }

  if (result && typeof result.then === "function") {
    return result.finally(cleanup);
  }

  cleanup();

  return result;
}

// ------------------------------------------------------------------ config

test("development: agent.config.json is still a credential source", () => {
  withFileConfig(() => {
    const c = buildConfig(
      {},
      {
        isPackaged: false,
      },
    );

    assert.equal(c.apiBaseUrl, FILE_CREDS.apiBaseUrl);

    assert.equal(c.agentUuid, FILE_CREDS.agentUuid);

    assert.equal(c.agentSecret, FILE_CREDS.agentSecret);

    assert.doesNotThrow(() => validateConfig(c));
  });
});

test("packaged: agent.config.json is ignored but production URL is still used", () => {
  withFileConfig(() => {
    const c = buildConfig(
      {},
      {
        isPackaged: true,
      },
    );

    assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);

    assert.equal(c.agentUuid, "");

    assert.equal(c.agentSecret, "");

    assert.throws(
      () => validateConfig(c),
      /Missing required agent configuration/,
    );
  });
});

test("packaged: ignoring the file also ignores its non-credential settings", () => {
  withFileConfig((file) => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...FILE_CREDS,
        heartbeatIntervalSeconds: 999,
      }),
    );

    assert.equal(
      buildConfig(
        {},
        {
          isPackaged: false,
        },
      ).heartbeatIntervalSeconds,
      999,
    );

    assert.equal(
      buildConfig(
        {},
        {
          isPackaged: true,
        },
      ).heartbeatIntervalSeconds,
      30,
    );

    // Packaged URL remains pinned to production.
    assert.equal(
      buildConfig(
        {},
        {
          isPackaged: true,
        },
      ).apiBaseUrl,
      PRODUCTION_API_BASE_URL,
    );
  });
});

test("packaged: secure-store credentials work while API URL remains pinned", () => {
  withFileConfig(() => {
    const secure = {
      apiBaseUrl: "https://enrolled.example/api",

      agentUuid: "enrolled-uuid",

      agentSecret: "enrolled-secret",
    };

    const c = buildConfig(secure, {
      isPackaged: true,
    });

    assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);

    assert.equal(c.agentUuid, secure.agentUuid);

    assert.equal(c.agentSecret, secure.agentSecret);

    assert.doesNotThrow(() => validateConfig(c));
  });
});

test("packaged: environment API URL cannot override production URL", () => {
  withFileConfig(() => {
    process.env.AGENT_API_BASE_URL = "https://attacker.example/api";

    const c = buildConfig(
      {
        apiBaseUrl: "https://stored.example/api",
        agentUuid: "enrolled-uuid",
        agentSecret: "enrolled-secret",
      },
      {
        isPackaged: true,
      },
    );

    assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);
  });
});

test("packaged: environment UUID and secret cannot override secure-store credentials", () => {
  withFileConfig(() => {
    process.env.AGENT_UUID = "environment-uuid";

    process.env.AGENT_SECRET = "environment-secret";

    const c = buildConfig(
      {
        apiBaseUrl: "https://stored.example/api",
        agentUuid: "enrolled-uuid",
        agentSecret: "enrolled-secret",
      },
      {
        isPackaged: true,
      },
    );

    assert.equal(c.apiBaseUrl, PRODUCTION_API_BASE_URL);

    assert.equal(c.agentUuid, "enrolled-uuid");

    assert.equal(c.agentSecret, "enrolled-secret");
  });
});

test("packaged detection: plain Node (headless / tests) is not packaged", () => {
  // require("electron") under plain Node is the binary path string,
  // not the API.
  assert.equal(isPackagedApp(), false);
});

// ------------------------------------------------------- electron-builder files

// electron-builder `files` semantics:
// a path is packaged when it matches at least one positive pattern
// and no "!" negation pattern.
function packagedByElectronBuilder(relPath, patterns) {
  const positives = patterns.filter((p) => !p.startsWith("!"));

  const negatives = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => p.slice(1));

  const opts = {
    dot: true,
  };

  return (
    positives.some((p) => minimatch(relPath, p, opts)) &&
    !negatives.some((p) => minimatch(relPath, p, opts))
  );
}

test("electron-builder: agent.config.json is not in the packaged files", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );

  const files = pkg.build.files;

  assert.ok(
    !files.includes("agent.config.json"),
    "agent.config.json must not be listed",
  );

  for (const p of [
    "agent.config.json",
    "src/agent.config.json",
    "agent.config.local.json",
  ]) {
    assert.equal(
      packagedByElectronBuilder(p, files),
      false,
      `${p} would be packaged`,
    );
  }

  assert.equal(packagedByElectronBuilder("src/main.js", files), true);

  assert.equal(packagedByElectronBuilder("package.json", files), true);
});

// ------------------------------------------- fresh packaged install (bootstrap)

function installFakeElectron({ userData }) {
  const record = {
    windows: [],
    tooltips: [],
    fetches: [],
    handlers: {},
  };

  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.loaded = null;

      this.webContents = {
        send() {},
        session: {},
      };

      record.windows.push(this);
    }

    loadFile(p) {
      this.loaded = p;
    }

    setMenuBarVisibility() {}

    on() {}

    show() {}

    hide() {}

    focus() {}

    isDestroyed() {
      return false;
    }

    isMinimized() {
      return false;
    }

    destroy() {}

    static getAllWindows() {
      return record.windows;
    }
  }

  const fake = {
    app: {
      isPackaged: true,

      getPath: () => userData,

      requestSingleInstanceLock: () => true,

      whenReady: () => new Promise(() => {}),

      on() {},

      quit() {},

      exit() {},

      setLoginItemSettings() {},
    },

    BrowserWindow: FakeBrowserWindow,

    ipcMain: {
      handle: (ch, fn) => {
        record.handlers[ch] = fn;
      },

      on() {},
    },

    powerMonitor: {
      on() {},
    },

    safeStorage: {
      isEncryptionAvailable: () => true,

      encryptString: (s) => Buffer.from(s),

      decryptString: (b) => b.toString(),
    },

    Tray: class {
      setToolTip(t) {
        record.tooltips.push(t);
      }

      setContextMenu() {}

      on() {}

      destroy() {}
    },

    Menu: {
      buildFromTemplate: (t) => t,
    },

    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => true,
      }),

      createEmpty: () => ({}),
    },

    dialog: {
      showMessageBox() {},
    },

    screen: {
      getPrimaryDisplay: () => ({
        id: 1,

        size: {
          width: 1,
          height: 1,
        },

        scaleFactor: 1,
      }),
    },

    desktopCapturer: {
      getSources: async () => [],
    },
  };

  const electronPath = require.resolve("electron");

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: fake,
  };

  return record;
}

test("fresh packaged install: does NOT authenticate with agent.config.json; shows setup", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "agent-userdata-"));

  const record = installFakeElectron({
    userData,
  });

  const realFetch = global.fetch;

  global.fetch = async (url) => {
    record.fetches.push(String(url));

    return {
      status: 200,
      json: async () => ({
        agent: {
          agent_uuid: "x",
        },
      }),
    };
  };

  try {
    await withFileConfig(async () => {
      assert.equal(isPackagedApp(), true);

      const { bootstrap } = require("../src/main");

      await bootstrap();

      assert.deepEqual(
        record.fetches,
        [],
        "no heartbeat may be sent with bundled/dev credentials",
      );

      assert.equal(record.windows.length, 1, "the setup window is created");

      assert.ok(/ui[\\/]+index\.html$/.test(record.windows[0].loaded));

      assert.equal(
        record.windows[0].opts.show,
        true,
        "setup window is shown, not hidden",
      );

      assert.match(
        record.tooltips[record.tooltips.length - 1],
        /Setup required/,
      );

      const state = await record.handlers["agent:getState"]();

      assert.equal(state.mode, "setup");

      assert.equal(typeof record.handlers["agent:connect"], "function");

      // Packaged build exposes production backend.
      assert.equal(state.defaultApiBaseUrl, PRODUCTION_API_BASE_URL);
    });
  } finally {
    global.fetch = realFetch;

    delete require.cache[require.resolve("electron")];

    fs.rmSync(userData, {
      recursive: true,
      force: true,
    });
  }
});
