"use strict";

// Stable extension ID.
//
// A Chromium extension's ID is derived from the PUBLIC key in the manifest's
// "key" field: ID = first 16 bytes of SHA-256(DER SubjectPublicKeyInfo), each
// hex nibble mapped 0-f -> a-p. Same key => same ID in Chrome and Edge, on every
// machine and from every folder. The matching PRIVATE key is NOT in this
// repository (see DEPLOYMENT.md §1) — this test also guards against it ever
// being committed.
//
// EXPECTED_EXTENSION_ID is pinned on purpose: changing the "key" changes the ID,
// which breaks the native-messaging allowed_origins and every force-install
// policy that names it. If this test fails you changed the key — that is a
// deliberate, coordinated change, not a refactor.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SOURCE_MANIFEST = path.join(ROOT, "manifest.json");
const DIST_MANIFEST = path.join(ROOT, "dist", "manifest.json");

const EXPECTED_EXTENSION_ID = "acfadakklgdcfmogimojahhgihenaiii";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, "base64");
  return crypto
    .createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

function build() {
  const r = spawnSync(process.execPath, ["build.js"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `build failed: ${r.stderr}`);
}

test("manifest key is a valid RSA public key (SPKI, >= 2048 bit)", () => {
  const { key } = readJson(SOURCE_MANIFEST);
  assert.equal(typeof key, "string");
  assert.match(key, /^[A-Za-z0-9+/]+={0,2}$/, "key must be plain base64 (no PEM header, no whitespace)");

  const pub = crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  assert.equal(pub.asymmetricKeyType, "rsa");
  assert.ok(pub.asymmetricKeyDetails.modulusLength >= 2048);
});

test("the key derives the pinned, stable extension ID", () => {
  const { key } = readJson(SOURCE_MANIFEST);
  const id = extensionIdFromKey(key);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, EXPECTED_EXTENSION_ID);
});

test("built dist/manifest.json carries the same key and therefore the same ID", () => {
  build();
  const src = readJson(SOURCE_MANIFEST);
  const dist = readJson(DIST_MANIFEST);
  assert.equal(dist.key, src.key);
  assert.equal(extensionIdFromKey(dist.key), EXPECTED_EXTENSION_ID);

  // rebuilding does not change the identity
  build();
  assert.equal(readJson(DIST_MANIFEST).key, src.key);
  assert.equal(extensionIdFromKey(readJson(DIST_MANIFEST).key), EXPECTED_EXTENSION_ID);
});

test("adding the key did not alter the rest of the manifest", () => {
  build();
  const dist = readJson(DIST_MANIFEST);
  assert.equal(dist.manifest_version, 3);
  assert.equal(dist.version, "1.0.0");
  assert.deepEqual(dist.permissions, ["nativeMessaging", "tabs"]);
  assert.deepEqual(dist.host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(dist.background, { service_worker: "background.js" });
  assert.deepEqual(dist.content_scripts, [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["content.bundle.js"],
      run_at: "document_start",
      all_frames: false,
    },
  ]);
  assert.equal(dist.minimum_chrome_version, "102");
  // the key is the only addition and is a PUBLIC value: no private-key fields
  for (const k of Object.keys(dist)) {
    assert.ok(!/private|secret|pem/i.test(k), `unexpected manifest field: ${k}`);
  }
});

test("no private key material exists anywhere in the extension folder", () => {
  // Built from parts so this file does not match its own scan.
  const PRIVATE_BLOCK = new RegExp("-----BEGIN " + "(?:[A-Z]+ )?PRIVATE KEY-----");
  const SKIP = new Set(["node_modules", "dist", ".git"]);
  const offenders = [];

  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (/\.(pem|key|p12|pfx)$/i.test(e.name)) offenders.push(`${path.relative(ROOT, p)} (key file)`);
      else if (/\.(js|json|md|ps1|bat|txt|html)$/i.test(e.name) && PRIVATE_BLOCK.test(fs.readFileSync(p, "utf8"))) {
        offenders.push(`${path.relative(ROOT, p)} (private key block)`);
      }
    }
  })(ROOT);

  assert.deepEqual(offenders, []);
});

test(".gitignore keeps private key files out of version control", () => {
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  for (const pattern of ["*.pem", "*.key"]) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), `.gitignore must list ${pattern}`);
  }
});
