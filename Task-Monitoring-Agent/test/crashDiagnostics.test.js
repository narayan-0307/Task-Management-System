"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { formatCrashDiagnostics } = require("../src/utils/crashDiagnostics");

test("formatCrashDiagnostics records timestamp, kind, agent_uuid, and error name/message/stack for an uncaughtException", () => {
  const err = new Error("boom");
  err.name = "TypeError";
  err.stack = "TypeError: boom\n    at somewhere.js:1:1";

  const lines = formatCrashDiagnostics("uncaughtException", err, "agent-123");
  const joined = lines.join("\n");

  assert.match(joined, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/); // ISO timestamp
  assert.match(joined, /FATAL-DIAGNOSTIC \(uncaughtException\)/);
  assert.match(joined, /Agent: agent-123/);
  assert.match(joined, /Error name: TypeError/);
  assert.match(joined, /Error message: boom/);
  assert.match(joined, /at somewhere\.js:1:1/);
});

test("formatCrashDiagnostics records diagnostics for an unhandledRejection", () => {
  const err = new Error("promise blew up");
  const lines = formatCrashDiagnostics("unhandledRejection", err, "agent-456");
  const joined = lines.join("\n");

  assert.match(joined, /FATAL-DIAGNOSTIC \(unhandledRejection\)/);
  assert.match(joined, /Agent: agent-456/);
  assert.match(joined, /Error message: promise blew up/);
});

test("formatCrashDiagnostics handles a non-Error rejection reason (string) without throwing", () => {
  const lines = formatCrashDiagnostics("unhandledRejection", "just a string reason", null);
  const joined = lines.join("\n");

  assert.match(joined, /Error name: NonErrorRejection/);
  assert.match(joined, /Error message: just a string reason/);
  assert.match(joined, /Agent: \(not connected\)/);
});

test("formatCrashDiagnostics handles a non-Error rejection reason (plain object) without leaking its contents", () => {
  // A rejection could be an arbitrary object — this must never be
  // JSON.stringify'd or otherwise dumped, since that is exactly how a secret
  // could leak if some call site ever rejected with e.g. a config object.
  const dangerousLookingObject = {
    agent_secret: "top-secret-value",
    agent_uuid: "agent-789",
  };
  const lines = formatCrashDiagnostics("unhandledRejection", dangerousLookingObject, null);
  const joined = lines.join("\n");

  assert.equal(joined.includes("top-secret-value"), false);
  assert.match(joined, /Error name: NonErrorRejection/);
});

test("formatCrashDiagnostics handles agentUuid omitted/null gracefully", () => {
  const lines = formatCrashDiagnostics("uncaughtException", new Error("x"));
  assert.match(lines.join("\n"), /Agent: \(not connected\)/);
});

test("formatCrashDiagnostics never includes common secret/token/content field names by construction", () => {
  const err = new Error("normal failure during heartbeat");
  const lines = formatCrashDiagnostics("uncaughtException", err, "agent-uuid-1");
  const joined = lines.join("\n").toLowerCase();

  for (const forbidden of ["agent_secret", "agentsecret", "authorization", "bearer ", "encryption_key", "captured"]) {
    assert.equal(joined.includes(forbidden), false, `must not contain "${forbidden}"`);
  }
});
