"use strict";

// Black-box test: runs the real native-host/install.ps1 (Step 4B) in an
// isolated environment (its own %LOCALAPPDATA%) and inspects the generated
// native-host.bat. Windows-only, like the rest of this deployment tooling.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const isWin = process.platform === "win32";
const INSTALL_PS1 = require.resolve("../native-host/install.ps1");
const UNINSTALL_PS1 = require.resolve("../native-host/uninstall.ps1");

function runInstall(localAppData) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1, "-ChromeId", "abcdefghijklmnopabcdefghijklmnop"],
    {
      env: { ...process.env, LOCALAPPDATA: localAppData },
      encoding: "utf8",
      timeout: 30000,
    },
  );
}

function runUninstall(localAppData) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", UNINSTALL_PS1], {
    env: { ...process.env, LOCALAPPDATA: localAppData },
    encoding: "utf8",
    timeout: 30000,
  });
}

test(
  "install.ps1 generates a native-host.bat with no system node.exe dependency",
  { skip: !isWin && "Windows-only deployment tooling" },
  () => {
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "hcc-install-test-"));
    try {
      const result = runInstall(localAppData);
      assert.equal(result.status, 0, `install.ps1 failed: ${result.stderr}`);

      const batPath = path.join(localAppData, "HumanCareMonitoring", "native-host.bat");
      assert.ok(fs.existsSync(batPath), "native-host.bat was not created");
      const bat = fs.readFileSync(batPath, "utf8");

      // 1 & 3: no system Node.js required.
      assert.equal(/node\.exe/i.test(bat) && !/electron\.exe/i.test(bat), false);
      assert.doesNotMatch(bat, /Program Files\\nodejs/i);

      // 4: ELECTRON_RUN_AS_NODE=1 is set.
      assert.match(bat, /set ELECTRON_RUN_AS_NODE=1/);

      // 3: the wrapper points at an Electron/Agent executable, not a bare node.exe.
      assert.match(bat, /electron\.exe|Task Monitoring Agent\.exe/i);

      // 5: nativeHost.js is forwarded as the script argument.
      assert.match(bat, /nativeHost\.js/);

      // 6: %* argument forwarding is preserved.
      assert.match(bat.trim(), /%\*\s*$/);

      // 7: paths are quoted (the generated command line has real spaces in it,
      // e.g. "Task Management System", "Task Monitoring Agent.exe").
      const execLine = bat.split("\n").find((l) => l.includes("nativeHost.js"));
      assert.ok(execLine, "expected an exec line referencing nativeHost.js");
      assert.match(execLine, /^"[^"]+"\s+"[^"]+"\s+%\*\s*$/);

      // 5 (security): no secrets/tokens/credentials of any kind in the .bat.
      for (const forbidden of ["secret", "token", "password", "Authorization", "Bearer "]) {
        assert.equal(bat.toLowerCase().includes(forbidden.toLowerCase()), false, `.bat unexpectedly contains "${forbidden}"`);
      }
    } finally {
      // install.ps1 also writes real HKCU\...\NativeMessagingHosts keys
      // (not scoped by LOCALAPPDATA) — clean those up via the real
      // uninstall.ps1 so this test never leaves the machine's actual
      // registry pointing at a now-deleted temp manifest.
      runUninstall(localAppData);
      fs.rmSync(localAppData, { recursive: true, force: true });
    }
  },
);

test(
  "uninstall.ps1 still removes everything install.ps1 wrote",
  { skip: !isWin && "Windows-only deployment tooling" },
  () => {
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "hcc-uninstall-test-"));
    try {
      const installResult = runInstall(localAppData);
      assert.equal(installResult.status, 0, `install.ps1 failed: ${installResult.stderr}`);
      const dir = path.join(localAppData, "HumanCareMonitoring");
      assert.ok(fs.existsSync(path.join(dir, "native-host.bat")));
      assert.ok(fs.existsSync(path.join(dir, "co.humancareconnect.monitoring.json")));

      const uninstallResult = runUninstall(localAppData);
      assert.equal(uninstallResult.status, 0, `uninstall.ps1 failed: ${uninstallResult.stderr}`);
      assert.equal(fs.existsSync(path.join(dir, "native-host.bat")), false);
      assert.equal(fs.existsSync(path.join(dir, "co.humancareconnect.monitoring.json")), false);
    } finally {
      fs.rmSync(localAppData, { recursive: true, force: true });
      // uninstall.ps1 also clears HKCU registry keys global to the real user
      // account, independent of LOCALAPPDATA — run it once more for real
      // cleanup in case the install step above registered them.
      runUninstall(localAppData);
    }
  },
);
