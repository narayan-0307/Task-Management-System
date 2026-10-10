// Packages dist/ into a signed CRX3 and writes an update.xml. No third-party
// dependencies. Usage (after `npm run build`):
//
//   HC_EXTENSION_KEY=<path to PKCS#8/PEM private key, OUTSIDE this repo>
//   HC_EXTENSION_UPDATE_BASE_URL=https://<extension host>
//   npm run package
//
// The private key is only ever read; its contents/path are never copied into
// dist/ or release/ and never printed.

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const EXPECTED_EXTENSION_ID = "acfadakklgdcfmogimojahhgihenaiii";
const SIGNATURE_CONTEXT = Buffer.from("CRX3 SignedData\x00", "latin1");

// ---------- protobuf (just the few wire types CRX3 needs) ----------

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function lenField(fieldNumber, bytes) {
  return Buffer.concat([varint(fieldNumber * 8 + 2), varint(bytes.length), bytes]);
}

function readVarint(buf, pos) {
  let result = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error("protobuf: truncated varint");
    const b = buf[pos++];
    result += (b & 0x7f) * mul;
    if (!(b & 0x80)) return { value: result, pos };
    mul *= 128;
  }
  throw new Error("protobuf: varint too long");
}

// Parses a message into [{field, bytes}] (length-delimited fields only; CRX3
// header messages contain nothing else).
function parseFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.pos;
    if ((tag.value & 7) !== 2) throw new Error("protobuf: unexpected wire type");
    const len = readVarint(buf, pos);
    pos = len.pos;
    if (pos + len.value > buf.length) throw new Error("protobuf: truncated field");
    fields.push({ field: Math.floor(tag.value / 8), bytes: buf.subarray(pos, pos + len.value) });
    pos += len.value;
  }
  return fields;
}

// ---------- extension id ----------

function extensionIdFromPublicKeyDer(spkiDer) {
  const hash = crypto.createHash("sha256").update(spkiDer).digest().subarray(0, 16);
  let id = "";
  for (const b of hash) id += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
  return id;
}

// ---------- ZIP (stored deterministically: sorted, fixed timestamp) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

// entries: [{ name: "manifest.json", data: Buffer }]
function buildZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of sorted) {
    const name = Buffer.from(e.name, "utf8");
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// Reads a zip produced by buildZip (central directory) -> [{ name, data }].
function listZipEntries(zip) {
  const eocd = zip.length - 22;
  if (eocd < 0 || zip.readUInt32LE(eocd) !== 0x06054b50) throw new Error("zip: end record not found");
  const count = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("zip: bad central header");
    const compSize = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const localOff = zip.readUInt32LE(pos + 42);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nameLen);
    const lNameLen = zip.readUInt16LE(localOff + 26);
    const lExtraLen = zip.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = zlib.inflateRawSync(zip.subarray(start, start + compSize));
    if (crc32(data) !== zip.readUInt32LE(pos + 16)) throw new Error("zip: crc mismatch for " + name);
    out.push({ name, data });
    pos += 46 + nameLen;
  }
  return out;
}

// ---------- CRX3 ----------

function signingInput(signedHeaderData, zip) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signedHeaderData.length, 0);
  return Buffer.concat([SIGNATURE_CONTEXT, len, signedHeaderData, zip]);
}

function buildCrx(zip, privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const crxId = crypto.createHash("sha256").update(spki).digest().subarray(0, 16);
  const signedHeaderData = lenField(1, crxId); // SignedData { crx_id }
  const signature = crypto.sign("sha256", signingInput(signedHeaderData, zip), privateKey); // RSASSA-PKCS1-v1_5
  const keyProof = Buffer.concat([lenField(1, spki), lenField(2, signature)]);
  const header = Buffer.concat([
    lenField(2, keyProof), // sha256_with_rsa
    lenField(10000, signedHeaderData), // signed_header_data
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}

// Parses and fully verifies a CRX3. Throws on any problem.
function parseCrx(crx) {
  if (crx.length < 12 || crx.toString("latin1", 0, 4) !== "Cr24") throw new Error("CRX: bad magic");
  const version = crx.readUInt32LE(4);
  if (version !== 3) throw new Error("CRX: version is " + version + ", expected 3");
  const headerLen = crx.readUInt32LE(8);
  if (12 + headerLen > crx.length) throw new Error("CRX: truncated header");
  const fields = parseFields(crx.subarray(12, 12 + headerLen));
  const zip = crx.subarray(12 + headerLen);
  const rsa = fields.filter((f) => f.field === 2);
  const signedHeaderFields = fields.filter((f) => f.field === 10000);
  if (rsa.length !== 1 || signedHeaderFields.length !== 1) throw new Error("CRX: unexpected header layout");
  const proof = parseFields(rsa[0].bytes);
  const publicKey = proof.find((f) => f.field === 1);
  const signature = proof.find((f) => f.field === 2);
  if (!publicKey || !signature) throw new Error("CRX: missing public key or signature");
  const signedHeaderData = signedHeaderFields[0].bytes;
  const crxId = parseFields(signedHeaderData).find((f) => f.field === 1);
  if (!crxId) throw new Error("CRX: missing crx_id");
  const derivedId = extensionIdFromPublicKeyDer(publicKey.bytes);
  let idFromHeader = "";
  for (const b of crxId.bytes) idFromHeader += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
  const verified = crypto.verify(
    "sha256",
    signingInput(signedHeaderData, zip),
    crypto.createPublicKey({ key: publicKey.bytes, format: "der", type: "spki" }),
    signature.bytes,
  );
  return {
    version,
    publicKeyDer: publicKey.bytes,
    signature: signature.bytes,
    extensionId: derivedId,
    headerCrxId: idFromHeader,
    signatureValid: verified,
    zip,
  };
}

function verifyCrx(crx, expectedId) {
  const info = parseCrx(crx);
  if (info.headerCrxId !== info.extensionId) throw new Error("CRX: crx_id does not match the embedded public key");
  if (info.extensionId !== expectedId) {
    throw new Error(`CRX: extension id is ${info.extensionId}, expected ${expectedId}`);
  }
  if (!info.signatureValid) throw new Error("CRX: signature verification failed");
  return info;
}

// ---------- update.xml ----------

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeBaseUrl(raw) {
  if (!raw) {
    throw new Error("HC_EXTENSION_UPDATE_BASE_URL is not set (e.g. https://extension.example.com).");
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("HC_EXTENSION_UPDATE_BASE_URL is not a valid URL.");
  }
  if (u.protocol !== "https:") throw new Error("HC_EXTENSION_UPDATE_BASE_URL must be an https:// URL.");
  if (/REPLACE_WITH/i.test(raw)) throw new Error("HC_EXTENSION_UPDATE_BASE_URL is still a placeholder.");
  return raw.replace(/\/+$/, "");
}

function generateUpdateXml({ extensionId, version, baseUrl }) {
  const codebase = `${baseUrl}/humancare-monitoring-${version}.crx`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">',
    `  <app appid="${extensionId}">`,
    `    <updatecheck codebase="${xmlEscape(codebase)}" version="${xmlEscape(version)}"/>`,
    "  </app>",
    "</gupdate>",
    "",
  ].join("\n");
}

// ---------- packaging ----------

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertKeyOutsideRepo(keyPath, repoRoot) {
  let real;
  try {
    real = fs.realpathSync(keyPath);
  } catch {
    throw new Error("HC_EXTENSION_KEY does not point to a readable file.");
  }
  if (isInside(real, fs.realpathSync(repoRoot)) || isInside(path.resolve(keyPath), path.resolve(repoRoot))) {
    throw new Error("HC_EXTENSION_KEY points inside the repository; keep the signing key outside it.");
  }
  return real;
}

function collectFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full, base));
    else if (entry.isFile()) {
      out.push({ name: path.relative(base, full).split(path.sep).join("/"), data: fs.readFileSync(full) });
    }
  }
  return out;
}

const FORBIDDEN_IN_PACKAGE = /\.(pem|key|p12|pfx|crx|zip|map)$|^(node_modules|\.git|test|src)\//i;

function packageExtension({ distDir, releaseDir, keyPath, baseUrl, expectedId, repoRoot }) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!keyPath) throw new Error("HC_EXTENSION_KEY is not set (path to the PEM signing key, outside the repo).");
  const realKeyPath = assertKeyOutsideRepo(keyPath, repoRoot);

  const manifestPath = path.join(distDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("dist/manifest.json not found. Run `npm run build` first.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version = manifest.version;
  if (typeof version !== "string" || !/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new Error("dist/manifest.json has no valid numeric version.");
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(realKeyPath));
  } catch {
    throw new Error("HC_EXTENSION_KEY is not a valid PEM private key.");
  }
  if (privateKey.asymmetricKeyType !== "rsa") throw new Error("HC_EXTENSION_KEY must be an RSA key.");

  const files = collectFiles(distDir);
  if (!files.length) throw new Error("dist/ is empty.");
  const bad = files.find((f) => FORBIDDEN_IN_PACKAGE.test(f.name) || f.data.includes("PRIVATE KEY"));
  if (bad) throw new Error(`dist/ contains a file that must not be packaged: ${bad.name}`);

  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  if (manifest.key && manifest.key !== spki.toString("base64")) {
    throw new Error("The signing key does not match the public key in manifest.json.");
  }

  const crx = buildCrx(buildZip(files), privateKey);
  const info = verifyCrx(crx, expectedId);

  fs.mkdirSync(releaseDir, { recursive: true });
  const crxName = `humancare-monitoring-${version}.crx`;
  fs.writeFileSync(path.join(releaseDir, crxName), crx);
  fs.writeFileSync(
    path.join(releaseDir, "update.xml"),
    generateUpdateXml({ extensionId: info.extensionId, version, baseUrl: normalizedBase }),
  );
  return { crxName, version, extensionId: info.extensionId, files: files.map((f) => f.name) };
}

function main() {
  const root = __dirname;
  try {
    const result = packageExtension({
      distDir: path.join(root, "dist"),
      releaseDir: path.join(root, "release"),
      keyPath: process.env.HC_EXTENSION_KEY,
      baseUrl: process.env.HC_EXTENSION_UPDATE_BASE_URL,
      expectedId: EXPECTED_EXTENSION_ID,
      repoRoot: root,
    });
    console.log(`Packaged release/${result.crxName} (version ${result.version})`);
    console.log(`Extension ID verified: ${result.extensionId}`);
    console.log("Wrote release/update.xml");
  } catch (err) {
    console.error("package failed: " + err.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  EXPECTED_EXTENSION_ID,
  varint,
  lenField,
  parseFields,
  extensionIdFromPublicKeyDer,
  buildZip,
  listZipEntries,
  buildCrx,
  parseCrx,
  verifyCrx,
  generateUpdateXml,
  normalizeBaseUrl,
  assertKeyOutsideRepo,
  packageExtension,
};
