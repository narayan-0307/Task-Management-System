"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("packaged agent with saved credentials is enrollment locked", async () => {
  const userData = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-enrollment-lock-"),
  );

  const handlers = {};
  const windows = [];

  class FakeBrowserWindow {
    constructor() {
      this.webContents = {
        send() {},
        session: {},
      };
      windows.push(this);
    }

    loadFile() {}
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
      return windows;
    }
  }

  const fakeApp = {
    isPackaged: true,
    getPath: () => userData,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on() {},
    quit() {},
    exit() {},
    setLoginItemSettings() {},
  };

  const electronPath = require.resolve("electron");

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: fakeApp,
      BrowserWindow: FakeBrowserWindow,

      ipcMain: {
        handle: (channel, handler) => {
          handlers[channel] = handler;
        },
        on() {},
      },

      powerMonitor: {
        on() {},
      },

      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (buffer) => buffer.toString(),
      },

      Tray: class {
        setToolTip() {}
        setContextMenu() {}
        on() {}
        destroy() {}
      },

      Menu: {
        buildFromTemplate: (template) => template,
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
    },
  };

  const savedEnv = {
    AGENT_API_BASE_URL: process.env.AGENT_API_BASE_URL,
    AGENT_UUID: process.env.AGENT_UUID,
    AGENT_SECRET: process.env.AGENT_SECRET,
    AGENT_CONFIG_PATH: process.env.AGENT_CONFIG_PATH,
  };

  delete process.env.AGENT_API_BASE_URL;
  delete process.env.AGENT_UUID;
  delete process.env.AGENT_SECRET;
  delete process.env.AGENT_CONFIG_PATH;

  try {
    // Simulate an already-enrolled packaged agent.
    fs.writeFileSync(
      path.join(userData, "agent-credentials.json"),
      JSON.stringify({
        apiBaseUrl: "https://darkviolet-cobra-939760.hostingersite.com/api",
        agentUuid: "saved-agent-uuid",
        secret_enc: Buffer.from("saved-agent-secret").toString("base64"),
      }),
    );

    const main = require("../src/main");

    // The packaged agent with saved credentials must be locked.
    assert.equal(main.__test.isEnrollmentLocked(), true);

    // A second enrollment attempt must be rejected.
    const connectResult = await handlers["agent:connect"](
      {},
      {
        apiBaseUrl: "https://example.com/api",
        agentUuid: "new-agent-uuid",
        agentSecret: "new-agent-secret",
      },
    );

    assert.deepEqual(connectResult, {
      ok: false,
      code: "locked",
    });

    // Reconfigure must also be rejected.
    const reconfigureResult = await handlers["agent:reconfigure"]({});

    assert.deepEqual(reconfigureResult, {
      ok: false,
      code: "locked",
    });
  } finally {
    if (savedEnv.AGENT_API_BASE_URL === undefined) {
      delete process.env.AGENT_API_BASE_URL;
    } else {
      process.env.AGENT_API_BASE_URL = savedEnv.AGENT_API_BASE_URL;
    }

    if (savedEnv.AGENT_UUID === undefined) {
      delete process.env.AGENT_UUID;
    } else {
      process.env.AGENT_UUID = savedEnv.AGENT_UUID;
    }

    if (savedEnv.AGENT_SECRET === undefined) {
      delete process.env.AGENT_SECRET;
    } else {
      process.env.AGENT_SECRET = savedEnv.AGENT_SECRET;
    }

    if (savedEnv.AGENT_CONFIG_PATH === undefined) {
      delete process.env.AGENT_CONFIG_PATH;
    } else {
      process.env.AGENT_CONFIG_PATH = savedEnv.AGENT_CONFIG_PATH;
    }

    delete require.cache[require.resolve("../src/main")];
    delete require.cache[electronPath];

    fs.rmSync(userData, {
      recursive: true,
      force: true,
    });
  }
});
