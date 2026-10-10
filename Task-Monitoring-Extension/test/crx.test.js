"use strict";

// Uses a THROWAWAY RSA key generated per run. The real signing key is never
// read by the unit tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const crx = require("../package-crx.js");

const REPO = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hc-crx-test-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const spki = publicKey.export({ type: "spki", format: "der" });
const TEST_ID = crx.extensionIdFromPublicKeyDer(spki);

const distDir = path.join(tmp, "dist");
const releaseDir = path.join(tmp, "release");
const keyPath = path.join(tmp, "throwaway.pem");
fs.mkdirSync(distDir);
fs.writeFileSync(keyPath, pem);
fs.writeFileSync(path.join(distDir, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "t", version: "2.3.4" }));
fs.writeFileSync(path.join(distDir, "background.js"), "// bg\n");
fs.writeFileSync(path.join(distDir, "content.bundle.js"), "// content\n");

const BASE = "https://extension.test.invalid/";
const run = () =>
  crx.packageExtension({ distDir, releaseDir, keyPath, baseUrl: BASE, expectedId: TEST_ID, repoRoot: REPO });
const result = run();
const crxBytes = fs.readFileSync(path.join(releaseDir, result.crxName));

test("CRX starts with Cr24 and is version 3", () => {
  assert.equal(crxBytes.toString("latin1", 0, 4), "Cr24");
  assert.equal(crxBytes.readUInt32LE(4), 3);
  assert.equal(result.crxName, "humancare-monitoring-2.3.4.crx");
});

test("header parses; public key and signature exist; id derived from key", () => {
  const info = crx.parseCrx(crxBytes);
  assert.ok(info.publicKeyDer.length > 200);
  assert.ok(info.signature.length === 256);
  assert.deepEqual(Buffer.from(info.publicKeyDer), spki);
  assert.equal(info.extensionId, TEST_ID);
  assert.equal(info.headerCrxId, TEST_ID);
  assert.equal(info.signatureValid, true);
});

test("protobuf helpers round-trip (incl. multi-byte tags/lengths)", () => {
  const big = Buffer.alloc(300, 7);
  const msg = Buffer.concat([crx.lenField(2, Buffer.from("ab")), crx.lenField(10000, big)]);
  const f = crx.parseFields(msg);
  assert.deepEqual(f.map((x) => x.field), [2, 10000]);
  assert.equal(f[1].bytes.length, 300);
  assert.throws(() => crx.parseFields(msg.subarray(0, msg.length - 1)));
});

test("tampering with the ZIP breaks the signature", () => {
  const bad = Buffer.from(crxBytes);
  bad[bad.length - 30] ^= 0xff;
  assert.equal(crx.parseCrx(bad).signatureValid, false);
  assert.throws(() => crx.verifyCrx(bad, TEST_ID), /signature/);
});

test("wrong expected id fails verification", () => {
  assert.throws(() => crx.verifyCrx(crxBytes, crx.EXPECTED_EXTENSION_ID), /extension id/);
});

test("ZIP holds the files at the root (no dist/ prefix) and nothing else", () => {
  const entries = crx.listZipEntries(crx.parseCrx(crxBytes).zip);
  assert.deepEqual(entries.map((e) => e.name), ["background.js", "content.bundle.js", "manifest.json"]);
  assert.equal(entries.find((e) => e.name === "background.js").data.toString(), "// bg\n");
});

test("packaging is deterministic", () => {
  run();
  assert.deepEqual(fs.readFileSync(path.join(releaseDir, result.crxName)).subarray(12 + 0), crxBytes.subarray(12));
});

test("update.xml: appid, version, https codebase from configured URL", () => {
  const xml = fs.readFileSync(path.join(releaseDir, "update.xml"), "utf8");
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes(`<app appid="${TEST_ID}">`));
  assert.ok(xml.includes('version="2.3.4"'));
  assert.ok(xml.includes('codebase="https://extension.test.invalid/humancare-monitoring-2.3.4.crx"'));
});

test("release/ contains only the CRX and update.xml; no private key anywhere", () => {
  const names = fs.readdirSync(releaseDir).sort();
  assert.deepEqual(names, ["humancare-monitoring-2.3.4.crx", "update.xml"]);
  for (const n of names) {
    const data = fs.readFileSync(path.join(releaseDir, n));
    assert.ok(!data.includes("PRIVATE KEY"));
    assert.ok(!data.includes(Buffer.from(privateKey.export({ type: "pkcs8", format: "der" })).subarray(0, 64)));
  }
});

test("update base URL must be set, https and not a placeholder", () => {
  assert.throws(() => crx.normalizeBaseUrl(""), /not set/);
  assert.throws(() => crx.normalizeBaseUrl("http://x.test"), /https/);
  assert.throws(() => crx.normalizeBaseUrl("https://REPLACE_WITH_EXTENSION_HOST"), /placeholder/);
  assert.equal(crx.normalizeBaseUrl("https://a.test///"), "https://a.test");
});

test("missing update URL fails before anything is written", () => {
  const out = path.join(tmp, "release2");
  assert.throws(
    () => crx.packageExtension({ distDir, releaseDir: out, keyPath, baseUrl: "", expectedId: TEST_ID, repoRoot: REPO }),
    /UPDATE_BASE_URL/,
  );
  assert.equal(fs.existsSync(out), false);
});

test("a key inside the repository is refused (error never contains key content)", () => {
  const root = fs.mkdtempSync(path.join(tmp, "repo-"));
  const inside = path.join(root, "k.pem");
  fs.writeFileSync(inside, pem);
  assert.throws(() => crx.assertKeyOutsideRepo(inside, root), (e) => /inside the repository/.test(e.message) && !e.message.includes("PRIVATE KEY"));
});

test("a key that does not match manifest.json's key is rejected", () => {
  const d = path.join(tmp, "dist-mk");
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ version: "1.0.0", key: "AAAA" }));
  assert.throws(
    () => crx.packageExtension({ distDir: d, releaseDir: path.join(tmp, "r3"), keyPath, baseUrl: BASE, expectedId: TEST_ID, repoRoot: REPO }),
    /does not match/,
  );
});

test("dist/ containing key material or key files is refused", () => {
  const d = path.join(tmp, "dist-bad");
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ version: "1.0.0" }));
  fs.writeFileSync(path.join(d, "leak.pem"), pem);
  assert.throws(
    () => crx.packageExtension({ distDir: d, releaseDir: path.join(tmp, "r4"), keyPath, baseUrl: BASE, expectedId: TEST_ID, repoRoot: REPO }),
    /must not be packaged/,
  );
});

test("npm package script exists, is separate from build, and the CLI fails clearly without HC_EXTENSION_KEY", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.scripts.package, "node package-crx.js");
  assert.equal(pkg.scripts.build, "node build.js");
  assert.doesNotMatch(pkg.scripts.test, /package/);
  const env = { ...process.env };
  delete env.HC_EXTENSION_KEY;
  env.HC_EXTENSION_UPDATE_BASE_URL = BASE;
  const r = spawnSync(process.execPath, [path.join(REPO, "package-crx.js")], { env, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /HC_EXTENSION_KEY is not set/);
});

test("release/ is git-ignored and the script hardcodes no key path", () => {
  assert.match(fs.readFileSync(path.join(REPO, ".gitignore"), "utf8"), /^release\/$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(REPO, "package-crx.js"), "utf8"), /humancare-secrets|\.pem["']/);
});
