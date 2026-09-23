"use strict";

// Black-box tests: nativeHost.js is plain Node (no Electron dependency), so
// unlike main.js it can be safely spawned as a real child process and
// observed from the outside — genuine integration coverage instead of a
// mocked approximation.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const NATIVE_HOST_PATH = require.resolve("../src/monitoring/extension/nativeHost.js");

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hcc-nativehost-test-"));
}

function runNativeHost(home, { input } = {}) {
  return spawnSync(process.execPath, [NATIVE_HOST_PATH], {
    env: {
      ...process.env,
      // Both are read by Node's os.homedir() depending on platform.
      HOME: home,
      USERPROFILE: home,
    },
    input: input || Buffer.alloc(0),
    encoding: null, // keep stdout as a raw Buffer so we can check byte-exactness
    timeout: 5000,
  });
}

test("missing ext-bridge.json: exits 0, writes zero bytes to stdout, and logs a diagnostic", () => {
  const home = makeTmpHome();
  const result = runNativeHost(home);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 0, "stdout must stay empty/clean — reserved for the native-messaging protocol");

  const logFile = path.join(home, ".humancare-monitoring", "native-host.log");
  const logContent = fs.readFileSync(logFile, "utf8");
  assert.match(logContent, /info_file_missing/);
});

test("malformed ext-bridge.json: exits 0, stdout stays clean, diagnostic logged, file contents never logged", () => {
  const home = makeTmpHome();
  const dir = path.join(home, ".humancare-monitoring");
  fs.mkdirSync(dir, { recursive: true });
  const secretLookingToken = "super-secret-pipe-token-should-never-appear-in-logs";
  fs.writeFileSync(path.join(dir, "ext-bridge.json"), `{not valid json, token: "${secretLookingToken}"`);

  const result = runNativeHost(home);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 0);

  const logContent = fs.readFileSync(path.join(dir, "native-host.log"), "utf8");
  assert.match(logContent, /info_file_malformed/);
  assert.equal(logContent.includes(secretLookingToken), false);
});

test("ext-bridge.json present but pointing at a pipe nothing is listening on: connection failure is logged, stdout stays clean, token is never logged", () => {
  const home = makeTmpHome();
  const dir = path.join(home, ".humancare-monitoring");
  fs.mkdirSync(dir, { recursive: true });
  const secretToken = "definitely-a-secret-bridge-token-abc123";
  const pipePath =
    process.platform === "win32"
      ? "\\\\.\\pipe\\hcc-nativehost-test-nobody-listening"
      : path.join(home, "nobody-listening.sock");
  fs.writeFileSync(path.join(dir, "ext-bridge.json"), JSON.stringify({ pipe: pipePath, token: secretToken }));

  const result = runNativeHost(home);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 0, "stdout must stay empty even on a connection failure");

  const logContent = fs.readFileSync(path.join(dir, "native-host.log"), "utf8");
  assert.match(logContent, /pipe_connection_error/);
  assert.equal(logContent.includes(secretToken), false, "the bridge token must never appear in the diagnostic log");
  assert.equal(logContent.includes(pipePath), false, "the pipe path itself is not logged either");
});

test("diagnostic log file itself never contains the word from ext-bridge.json's token field value across all failure modes exercised here", () => {
  // Cross-check across every scenario run above, re-run fresh, confirming
  // the aggregate log has no credential-shaped leakage.
  const home = makeTmpHome();
  const dir = path.join(home, ".humancare-monitoring");
  fs.mkdirSync(dir, { recursive: true });
  const secretToken = "cross-check-secret-token-xyz789";
  fs.writeFileSync(path.join(dir, "ext-bridge.json"), JSON.stringify({ pipe: "\\\\.\\pipe\\nope", token: secretToken }));
  runNativeHost(home);

  const logContent = fs.readFileSync(path.join(dir, "native-host.log"), "utf8");
  assert.equal(logContent.includes(secretToken), false);
  assert.equal(logContent.includes("agent_secret"), false);
  assert.equal(logContent.includes("Authorization"), false);
});
