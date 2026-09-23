"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshModule(homeOverride) {
  // Point os.homedir() at an isolated temp dir per test by re-requiring with
  // a stubbed os.homedir — simplest safe way to avoid polluting the real
  // ~/.humancare-monitoring directory during tests.
  const modPath = require.resolve("../src/monitoring/extension/nativeHostDiagnostics");
  delete require.cache[modPath];
  const originalHomedir = os.homedir;
  os.homedir = () => homeOverride;
  try {
    return require(modPath);
  } finally {
    os.homedir = originalHomedir;
  }
}

function makeTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hcc-diag-test-"));
}

test("logFailure() writes a bounded, timestamped, category-labeled line to the local log file", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  diag.logFailure("pipe_connection_error", "ECONNREFUSED");

  const content = fs.readFileSync(diag.LOG_FILE, "utf8");
  assert.match(content, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] pipe_connection_error - ECONNREFUSED\n$/);
});

test("logFailure() works with no detail argument", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  diag.logFailure("pipe_closed");

  const content = fs.readFileSync(diag.LOG_FILE, "utf8");
  assert.match(content, /pipe_closed\n$/);
  assert.equal(content.includes(" - "), false);
});

test("logFailure() appends multiple entries across calls", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  diag.logFailure("info_file_missing");
  diag.logFailure("stdin_ended");

  const lines = fs.readFileSync(diag.LOG_FILE, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /info_file_missing/);
  assert.match(lines[1], /stdin_ended/);
});

test("logFailure() never throws even if detail is an unusual value", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  assert.doesNotThrow(() => diag.logFailure("decode_error_from_agent", undefined));
  assert.doesNotThrow(() => diag.logFailure("decode_error_from_chrome", null));
  assert.doesNotThrow(() => diag.logFailure("uncaught_exception", { not: "a string" }));
});

test("logFailure() truncates an overly long detail string", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  const long = "x".repeat(5000);
  diag.logFailure("decode_error_from_chrome", long);

  const content = fs.readFileSync(diag.LOG_FILE, "utf8");
  const detailLine = content.trim();
  assert.ok(detailLine.length < 5000);
  assert.ok(detailLine.includes("…"));
});

test("logFailure() bounds total log file size (truncates instead of growing without limit)", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  // Write enough entries to exceed MAX_LOG_BYTES at least once.
  const chunk = "y".repeat(500);
  const entriesNeeded = Math.ceil((diag.MAX_LOG_BYTES / (chunk.length + 40)) + 5);
  for (let i = 0; i < entriesNeeded; i++) {
    diag.logFailure("stdin_error", chunk);
  }
  const size = fs.statSync(diag.LOG_FILE).size;
  // After bounded truncation, the file should never be allowed to grow much
  // past one MAX_LOG_BYTES window plus the latest single entry.
  assert.ok(size < diag.MAX_LOG_BYTES + chunk.length + 200, `log grew unbounded: ${size} bytes`);
});

test("logFailure() output never contains anything resembling a token, secret, or credential field", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  diag.logFailure("pipe_connection_error", "ECONNREFUSED");
  diag.logFailure("info_file_malformed", "SyntaxError");
  diag.logFailure("decode_error_from_agent", "Unexpected token");

  const content = fs.readFileSync(diag.LOG_FILE, "utf8").toLowerCase();
  for (const forbidden of ["token", "secret", "password", "authorization", "bearer ", "pipe\\\\"]) {
    // "token" appears intentionally in one error message above (Unexpected
    // token) — that's a codec error description, not a credential, so allow
    // it specifically while still checking the others strictly.
    if (forbidden === "token") continue;
    assert.equal(content.includes(forbidden), false, `log unexpectedly contains "${forbidden}"`);
  }
});

test("LOG_FILE lives under the per-user .humancare-monitoring directory (same convention as ext-bridge.json)", () => {
  const home = makeTmpHome();
  const diag = freshModule(home);
  assert.equal(diag.LOG_DIR, path.join(home, ".humancare-monitoring"));
  assert.equal(diag.LOG_FILE, path.join(home, ".humancare-monitoring", "native-host.log"));
});
