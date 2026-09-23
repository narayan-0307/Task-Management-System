"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeHost,
  normalizeDomain,
  registrableDomainFromHost,
  queryAddressBarValues,
  _resetQueryCache,
  _PS_SCRIPT,
} = require("../src/monitoring/domainDetector");
const { classifyTarget } = require("../src/monitoring/contentCapture");

// --- PS_SCRIPT: targeted omnibox lookup + FindAll fallback ordering -----
// The actual UI Automation call can't be exercised outside Windows/a live
// browser, so these assert on the embedded selector logic itself: the
// omnibox AutomationId lookup (FindFirst, short-circuiting) must run BEFORE
// — and only fall back to — the exhaustive Edit-control scan (FindAll).

test("PS_SCRIPT: looks up the omnibox by AutomationId using FindFirst before the FindAll fallback", () => {
  const omniboxIdx = _PS_SCRIPT.indexOf("AutomationIdProperty");
  const findFirstIdx = _PS_SCRIPT.indexOf("FindFirst(");
  const findAllIdx = _PS_SCRIPT.indexOf("FindAll(");

  assert.ok(_PS_SCRIPT.includes('"omnibox"'), "must query AutomationId \"omnibox\"");
  assert.ok(findFirstIdx !== -1, "must use FindFirst for the targeted omnibox lookup");
  assert.ok(findAllIdx !== -1, "must still keep the FindAll fallback");
  assert.ok(findFirstIdx < findAllIdx, "FindFirst (omnibox) must run before the FindAll fallback");
  assert.ok(omniboxIdx < findAllIdx, "the omnibox condition must be built before the fallback scan");
});

test("PS_SCRIPT: FindAll fallback only runs when the omnibox lookup found nothing", () => {
  assert.ok(
    /if\s*\(\$vals\.Count\s*-eq\s*0\)/.test(_PS_SCRIPT),
    "the Edit-control scan must be gated on the omnibox lookup having produced no values",
  );
});

test("PS_SCRIPT: still gates on every previously-supported browser process name", () => {
  for (const b of ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "chromium"]) {
    assert.ok(_PS_SCRIPT.includes(`'${b}'`), `must still match process name "${b}"`);
  }
});

// --- normalizeHost: full host, www stripped, junk rejected --------------

test("normalizeHost: keeps the full host, strips scheme/path/query and www", () => {
  assert.equal(normalizeHost("https://www.google.com/search?q=hello"), "google.com");
  assert.equal(normalizeHost("https://gemini.google.com/app"), "gemini.google.com");
  assert.equal(normalizeHost("https://chat.openai.com/c/123"), "chat.openai.com");
  assert.equal(normalizeHost("mail.google.com"), "mail.google.com");
  assert.equal(normalizeHost("https://EN.Wikipedia.ORG/wiki/X"), "en.wikipedia.org");
  assert.equal(normalizeHost("https://bbc.co.uk"), "bbc.co.uk");
});

test("normalizeHost: rejects non-web / internal / malformed values", () => {
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost("   "), null);
  assert.equal(normalizeHost("how to center a div"), null);
  assert.equal(normalizeHost("chrome://settings"), null);
  assert.equal(normalizeHost("about:blank"), null);
  assert.equal(normalizeHost("localhost"), null);
  assert.equal(normalizeHost("http://localhost:3000"), null);
  assert.equal(normalizeHost(null), null);
});

// --- registrableDomainFromHost ----------------------------------------

test("registrableDomainFromHost: last two labels, three for known ccTLDs", () => {
  assert.equal(registrableDomainFromHost("gemini.google.com"), "google.com");
  assert.equal(registrableDomainFromHost("google.com"), "google.com");
  assert.equal(registrableDomainFromHost("a.b.c.example.com"), "example.com");
  assert.equal(registrableDomainFromHost("news.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomainFromHost("shop.example.co.in"), "example.co.in");
});

// --- normalizeDomain: UNCHANGED behavior (events pipeline depends on it) --

test("normalizeDomain: still collapses to the registrable domain (regression)", () => {
  assert.equal(normalizeDomain("https://www.youtube.com/results?search_query=cats"), "youtube.com");
  assert.equal(normalizeDomain("https://youtube.com/watch?v=abc"), "youtube.com");
  assert.equal(normalizeDomain("https://gemini.google.com/app"), "google.com");
  assert.equal(normalizeDomain("https://chat.openai.com/c/1"), "openai.com");
  assert.equal(normalizeDomain("https://sub.domain.example.co.uk/x"), "example.co.uk");
  assert.equal(normalizeDomain("not a url"), null);
});

// --- integration: address-bar normalization -> capture classification ---
// (the coverage gap that previously hid the Gemini / chat.openai.com bugs)

const editField = (over = {}) => ({
  controlType: "ControlType.Edit",
  name: "",
  automationId: "",
  ariaRole: "",
  localizedControlType: "",
  isPassword: false,
  ...over,
});
const promptField = () => editField({ controlType: "ControlType.Document" });
const searchField = () => editField({ ariaRole: "searchbox" });

function classifyUrl(url, field) {
  const host = normalizeHost(url);
  const reg = normalizeDomain(url);
  return classifyTarget(host, reg, field);
}

test("integration: the 5 originally-supported sites classify correctly end to end", () => {
  assert.equal(classifyUrl("https://www.google.com/search?q=x", editField({ name: "q" })).kind, "search");
  assert.equal(classifyUrl("https://www.youtube.com/results?search_query=x", editField({ name: "search_query" })).kind, "search");
  assert.equal(classifyUrl("https://chatgpt.com/c/1", promptField()).kind, "prompt");
  assert.equal(classifyUrl("https://chat.openai.com/c/1", promptField()).kind, "prompt");
  assert.equal(classifyUrl("https://claude.ai/chat/1", promptField()).kind, "prompt");
  assert.equal(classifyUrl("https://gemini.google.com/app", promptField()).kind, "prompt");
});

test("integration: Gemini is attributed to gemini.google.com, not google.com", () => {
  const t = classifyUrl("https://gemini.google.com/app", promptField());
  assert.equal(t.kind, "prompt");
  assert.equal(t.label, "Gemini");
});

test("integration: arbitrary sites with a search field are captured with the right host", () => {
  for (const [url, field, host] of [
    ["https://www.bing.com/search?q=x", searchField(), "bing.com"],
    ["https://duckduckgo.com/?q=x", editField({ name: "q" }), "duckduckgo.com"],
    ["https://stackoverflow.com/search?q=x", editField({ automationId: "search" }), "stackoverflow.com"],
    ["https://www.amazon.com/s?k=x", editField({ name: "Search Amazon" }), "amazon.com"],
    ["https://github.com/search", editField({ name: "Search or jump to…" }), "github.com"],
  ]) {
    const t = classifyUrl(url, field);
    assert.ok(t, `${url} should classify`);
    assert.equal(t.kind, "search");
    assert.equal(t.label, host);
  }
});

test("integration: a non-search field on an arbitrary site is not captured", () => {
  assert.equal(classifyUrl("https://example.com/signup", editField({ name: "Email" })), null);
  assert.equal(classifyUrl("https://mail.google.com/mail/u/0", promptField()), null); // Document, not a prompt site
});

// --- queryAddressBarValues: cache + in-flight de-dupe ---------------------
// The underlying query spawns powershell.exe and walks the whole foreground
// window's accessibility tree — expensive, and called independently by the
// activity tracker AND content capture on their own timers. These tests use
// the `deps.run` / `deps.now` test seam so no real process is spawned.

test.afterEach(() => _resetQueryCache());

const CHROME = { applicationName: "Google Chrome" };

test("queryAddressBarValues: a second call within the TTL reuses the cached result, no second run", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve(["https://youtube.com/results?search_query=x"]);
  };
  let now = 1000;
  const deps = { run, now: () => now };

  const a = await queryAddressBarValues(CHROME, deps);
  now += 1500; // well inside the 5000ms TTL
  const b = await queryAddressBarValues(CHROME, deps);

  assert.deepEqual(a, ["https://youtube.com/results?search_query=x"]);
  assert.deepEqual(b, a);
  assert.equal(calls, 1, "second call must reuse the cache, not re-run the query");
});

test("queryAddressBarValues: a call after the TTL expires re-runs the query", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve([`value-${calls}`]);
  };
  let now = 1000;
  const deps = { run, now: () => now };

  await queryAddressBarValues(CHROME, deps);
  now += 6000; // past the 5000ms TTL
  await queryAddressBarValues(CHROME, deps);

  assert.equal(calls, 2, "an expired cache entry must trigger a fresh query");
});

test("queryAddressBarValues: switching foreground app invalidates the cache even within the TTL", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve([`value-${calls}`]);
  };
  const deps = { run, now: () => 1000 };

  await queryAddressBarValues(CHROME, deps);
  await queryAddressBarValues({ applicationName: "Microsoft Edge" }, deps);

  assert.equal(calls, 2, "a different foreground app must not reuse another app's cached value");
});

test("queryAddressBarValues: a window-title change (navigation) invalidates the cache — the blocklist never sees a stale host", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve([`value-${calls}`]);
  };
  const deps = { run, now: () => 1000 }; // same instant — TTL is not the trigger here

  await queryAddressBarValues({ applicationName: "Google Chrome", windowTitle: "Cats - YouTube" }, deps);
  await queryAddressBarValues({ applicationName: "Google Chrome", windowTitle: "Sign in - Chase" }, deps);

  assert.equal(calls, 2, "navigating (title change) must force a fresh address-bar read");
});

test("queryAddressBarValues: two concurrent callers share one in-flight query (no duplicate spawn)", async () => {
  let calls = 0;
  let resolveRun;
  const run = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveRun = resolve;
    });
  };
  const deps = { run, now: () => 1000 };

  const p1 = queryAddressBarValues(CHROME, deps);
  const p2 = queryAddressBarValues(CHROME, deps); // arrives while p1 is still pending
  resolveRun(["https://amazon.com/s?k=x"]);
  const [a, b] = await Promise.all([p1, p2]);

  assert.equal(calls, 1, "a concurrent second caller must not spawn a second query");
  assert.deepEqual(a, ["https://amazon.com/s?k=x"]);
  assert.deepEqual(b, a);
});

test("queryAddressBarValues: a failed query is not cached and does not poison the next call", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return calls === 1 ? Promise.resolve(null) : Promise.resolve(["https://chatgpt.com/c/1"]);
  };
  const deps = { run, now: () => 1000 };

  const a = await queryAddressBarValues(CHROME, deps);
  const b = await queryAddressBarValues(CHROME, deps); // immediately after, still same "now"

  assert.equal(a, null);
  assert.deepEqual(b, ["https://chatgpt.com/c/1"]);
  assert.equal(calls, 2, "a null/failed result must not be cached");
});

test("queryAddressBarValues: unsupported / missing foreground app never invokes run()", async () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    return Promise.resolve(["https://example.com"]);
  };
  const deps = { run, now: () => 1000 };

  assert.equal(await queryAddressBarValues(null, deps), null);
  assert.equal(await queryAddressBarValues({ applicationName: "Notepad" }, deps), null);
  assert.equal(calls, 0);
});
