"use strict";

// Runs the REAL content script (detector.js + content.js, concatenated exactly
// as build.js does) against a minimal mock DOM, so behaviour that lives in
// content.js — isTrusted rejection, editing-host resolution, the attributes it
// forwards — is covered, not just the pure detector.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "src");

// Same transform as build.js (keep in sync): strip "use strict" + module.exports
// from detector.js and expose it as `const detector = (function(){...})()`.
function bundleSource() {
  let detector = fs.readFileSync(path.join(SRC, "detector.js"), "utf8");
  detector = detector.replace(/^\s*"use strict";\s*$/m, "");
  detector = detector.replace(
    /module\.exports\s*=\s*(\{[\s\S]*?\});\s*$/,
    "return $1;",
  );
  return [
    '"use strict";',
    "const detector = (function () {",
    detector,
    "})();",
    "",
    fs.readFileSync(path.join(SRC, "content.js"), "utf8"),
  ].join("\n");
}

function makePage(url) {
  const listeners = {};
  const winListeners = {};
  const sent = [];
  let onConfig;
  const ctx = {
    URL,
    queueMicrotask,
    location: { href: url },
    history: { pushState() {}, replaceState() {} },
    window: { addEventListener: (t, f) => (winListeners[t] = f) },
    document: { addEventListener: (t, f) => (listeners[t] = f) },
    chrome: {
      runtime: {
        onMessage: { addListener: (f) => (onConfig = f) },
        sendMessage: (m) => {
          if (m.t === "capture") sent.push(m);
        },
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(bundleSource(), ctx);
  onConfig({ t: "config", enabled: true, blocklist: [] });

  return {
    sent,
    pressEnter(path, { trusted = true } = {}) {
      sent.length = 0;
      listeners.keydown({
        isTrusted: trusted,
        key: "Enter",
        isComposing: false,
        shiftKey: false,
        composedPath: () => path,
      });
      return sent[0] || null;
    },
    // A trusted <form> submit. `formEl` comes from form(); the submitted field
    // is the form's first input, exactly as the real handler falls back to.
    pressSubmit(formEl, { trusted = true } = {}) {
      sent.length = 0;
      listeners.submit({
        isTrusted: trusted,
        target: formEl,
        composedPath: () => [formEl],
      });
      return sent[0] || null;
    },
    // Back/Forward within the document: the only way the URL-change path fires
    // today (the pushState hook can't see the page's own calls — that is F-06).
    popstateTo(nextUrl) {
      sent.length = 0;
      ctx.location.href = nextUrl;
      winListeners.popstate();
      return sent[0] || null;
    },
  };
}

// A DOM-ish element. `host` makes it a descendant of an editing host (like the
// <p> you type in inside a ProseMirror composer). `form` is its form ancestor.
function el({ tag = "INPUT", attrs = {}, value = "some text", ce = false, host = null, form = null }) {
  const node = {
    tagName: tag,
    id: attrs.id || "",
    isContentEditable: ce || Boolean(host),
    innerText: value,
    value,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    closest(sel) {
      if (sel.includes("contenteditable")) {
        return host || (node.isContentEditable ? node : null);
      }
      if (sel === "form") return form;
      return null; // no search ancestors in these mocks
    },
  };
  return node;
}

// A <form>. `action` = the explicit action ATTRIBUTE (null = no attribute);
// `field` is what the submit handler falls back to as the submitted input.
function form({ action = null, field = null } = {}) {
  const f = {
    tagName: "FORM",
    action: action === null ? "https://page.example/current-page" : action, // DOM falls back to the document URL
    getAttribute: (k) => (k === "action" ? action : null),
    querySelector: () => field,
  };
  return f;
}

test("content: untrusted (synthetic) Enter is rejected, trusted Enter is captured", () => {
  const page = makePage("https://shop.example.com/");
  const field = el({ attrs: { type: "text", name: "q" }, value: "usb hub" });
  assert.equal(page.pressEnter([field], { trusted: false }), null);
  assert.equal(page.pressEnter([field], { trusted: true })?.text, "usb hub");
});

test("content: Claude composer — typing in the inner <p> resolves to the editing host", () => {
  const page = makePage("https://claude.ai/new");
  const host = el({
    tag: "DIV",
    ce: true,
    value: "line one\nline two",
    attrs: {
      "aria-label": "Write your prompt to Claude",
      "data-testid": "chat-input",
      "data-composer-editor": "marlin",
      role: "textbox",
    },
  });
  const leaf = el({ tag: "P", value: "line two", host });
  const hit = page.pressEnter([leaf, host]);
  assert.equal(hit?.kind, "prompt");
  assert.equal(hit?.text, "line one\nline two"); // whole editor, not just the paragraph
});

test("content: Perplexity composer (id=ask-input) in an inner node is a prompt", () => {
  const page = makePage("https://www.perplexity.ai/");
  const host = el({ tag: "DIV", ce: true, value: "best laptops", attrs: { id: "ask-input" } });
  const leaf = el({ tag: "SPAN", value: "best laptops", host });
  assert.equal(page.pressEnter([leaf, host])?.kind, "prompt");
});

test("content: F-09 negatives through the real script", () => {
  const chat = makePage("https://chatgpt.com/");
  // rename-chat input
  assert.equal(chat.pressEnter([el({ attrs: { type: "text" }, value: "Q3 planning" })]), null);
  // "Search chats" input is a search, never a prompt
  assert.equal(
    chat.pressEnter([el({ attrs: { type: "text", placeholder: "Search chats..." }, value: "budget" })])?.kind,
    "search",
  );
  // custom-instructions textarea (no composer evidence)
  assert.equal(chat.pressEnter([el({ tag: "TEXTAREA", value: "I am a nurse" })]), null);

  // sub-domain help search stays a plain search
  const help = makePage("https://support.claude.ai/");
  assert.equal(
    help.pressEnter([el({ attrs: { type: "search" }, value: "billing" })])?.kind,
    "search",
  );
  // and a composer-shaped field there is not a prompt
  assert.equal(
    help.pressEnter([el({ tag: "TEXTAREA", attrs: { name: "prompt" }, value: "hello" })]),
    null,
  );
});

test("content: untrusted Enter in a real composer is also rejected", () => {
  const page = makePage("https://chatgpt.com/");
  const composer = el({ tag: "TEXTAREA", attrs: { name: "prompt", id: "mobile-composer-prompt" }, value: "forged prompt" });
  assert.equal(page.pressEnter([composer], { trusted: false }), null);
  assert.equal(page.pressEnter([composer], { trusted: true })?.kind, "prompt");
});

// --- F-10: form-action and URL evidence, through the real content script -----

test("F-10 content: form action names a strong param AND it is the field's name -> search", () => {
  for (const [action, name] of [
    ["/search?q=", "q"],
    ["/search?query=", "query"],
    ["/results?search_query=", "search_query"],
  ]) {
    const page = makePage("https://shop.example.com/");
    const f = form({ action });
    const input = el({ attrs: { type: "text", name }, value: "usb hub", form: f });
    f.querySelector = () => input;
    assert.equal(page.pressEnter([input])?.kind, "search", `enter ${action}`);
    assert.equal(page.pressSubmit(f)?.kind, "search", `submit ${action}`);
  }
});

test("F-10 content: an action parameter unrelated to the field is NOT evidence", () => {
  // Before F-10 each of these became a "search" because the action carried any
  // listed parameter with a value.
  for (const [action, name, label] of [
    ["/some-page?text=hello", "message", "comment form posting ?text="],
    ["/search?query=shoes", "phrase", "strong param, different field name"],
    ["/list?s=asc", "note", "generic ?s="],
    ["/list?keywords=a", "bio", "generic ?keywords="],
    ["/list?p=12", "reply", "generic ?p="],
  ]) {
    const page = makePage("https://forum.example.com/thread/9");
    const f = form({ action });
    const input = el({ tag: "TEXTAREA", attrs: { name }, value: "see you at five", form: f });
    f.querySelector = () => input;
    assert.equal(page.pressEnter([input]), null, `enter: ${label}`);
    assert.equal(page.pressSubmit(f), null, `submit: ${label}`);
  }
});

test("F-10 content: no action attribute -> no form evidence (page ?q= does not leak in)", () => {
  const page = makePage("https://example.com/article?q=existing");
  const f = form({ action: null }); // f.action falls back to the page URL, as in a real DOM
  const input = el({ attrs: { type: "text", name: "message" }, value: "hello", form: f });
  f.querySelector = () => input;
  assert.equal(page.pressEnter([input]), null);
  assert.equal(page.pressSubmit(f), null);
});

test("F-10 content: normal message field on a page whose URL has ?q= is not a search (F-01)", () => {
  const page = makePage("https://www.linkedin.com/search/results/people/?q=developer");
  const input = el({ tag: "TEXTAREA", attrs: { name: "message", "aria-label": "Write a message" }, value: "Hello" });
  assert.equal(page.pressEnter([input]), null);
});

test("F-10 content: URL-change path (Back/Forward) records strong params only", () => {
  let page = makePage("https://example.com/home");
  assert.equal(page.popstateTo("https://example.com/list?p=12"), null);
  assert.equal(page.popstateTo("https://example.com/list?s=asc"), null);
  assert.equal(page.popstateTo("https://example.com/home"), null);
  assert.equal(page.popstateTo("https://example.com/list?text=hi"), null);
  assert.equal(page.popstateTo("https://example.com/home"), null);
  assert.equal(page.popstateTo("https://example.com/list?keywords=a"), null);

  page = makePage("https://example.com/home");
  const hit = page.popstateTo("https://example.com/results?search_query=lofi");
  assert.equal(hit?.kind, "search");
  assert.equal(hit?.text, "lofi");
});
