"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROMPT_HOSTS,
  SEARCH_PARAMS,
  classifyCommit,
  looksLikeSearchField,
  urlHasSearchParam,
  formActionMatchesField,
  normalizeHost,
  registrableDomain,
} = require("../src/detector");

const input = (over = {}) => ({
  tag: "input",
  type: "text",
  role: "",
  name: "",
  id: "",
  ariaLabel: "",
  placeholder: "",
  value: "",
  isContentEditable: false,
  inSearchRole: false,
  formHasSearchParam: false,
  ...over,
});

// --- host helpers -------------------------------------------------------

test("normalizeHost / registrableDomain", () => {
  assert.equal(
    normalizeHost("https://www.google.com/search?q=x"),
    "google.com",
  );
  assert.equal(
    normalizeHost("https://gemini.google.com/app"),
    "gemini.google.com",
  );
  assert.equal(normalizeHost("chrome://settings"), null);
  assert.equal(registrableDomain("gemini.google.com"), "google.com");
  assert.equal(registrableDomain("news.bbc.co.uk"), "bbc.co.uk");
});

test("urlHasSearchParam picks up STRONG params only (q / query / search_query)", () => {
  assert.equal(
    urlHasSearchParam("https://x.com/s?q=hello%20world"),
    "hello world",
  );
  assert.equal(
    urlHasSearchParam("https://x.com/results?search_query=lofi"),
    "lofi",
  );
  assert.equal(urlHasSearchParam("https://x.com/s?query=usb+c+cable"), "usb c cable");
  // F-10: "k" (Amazon) is a generic name — no longer proof of a search by URL.
  assert.equal(urlHasSearchParam("https://x.com/s?k=usb+c+cable"), null);
  assert.equal(urlHasSearchParam("https://x.com/page?ref=nav"), null);
  assert.equal(urlHasSearchParam("not a url"), null);
});

// --- field classification ---------------------------------------------

test("looksLikeSearchField: type=search / role / tokens / form param", () => {
  assert.equal(looksLikeSearchField(input({ type: "search" })), true);
  assert.equal(looksLikeSearchField(input({ role: "searchbox" })), true);
  assert.equal(looksLikeSearchField(input({ inSearchRole: true })), true);
  assert.equal(looksLikeSearchField(input({ name: "q" })), true);
  assert.equal(looksLikeSearchField(input({ name: "search_query" })), true);
  assert.equal(
    looksLikeSearchField(input({ ariaLabel: "Search Amazon" })),
    true,
  );
  assert.equal(
    looksLikeSearchField(input({ placeholder: "Search YouTube" })),
    true,
  );
  assert.equal(looksLikeSearchField(input({ formHasSearchParam: true })), true);
  assert.equal(
    looksLikeSearchField(input({ name: "email" }), "https://x.com/signup"),
    false,
  );
  assert.equal(
    looksLikeSearchField(input({ type: "password", name: "q" })),
    false,
  );
});

test("classifyCommit: form submit of a search field -> search + host", () => {
  const r = classifyCommit({
    type: "submit",
    pageUrl: "https://www.amazon.com/",
    navUrl: "https://www.amazon.com/s?k=mechanical+keyboard",
    field: input({
      name: "field-keywords",
      ariaLabel: "Search Amazon",
      value: "mechanical keyboard",
    }),
  });
  assert.deepEqual(r, {
    kind: "search",
    text: "mechanical keyboard",
    host: "amazon.com",
    registrableDomain: "amazon.com",
  });
});

test("classifyCommit: SPA search via URL change (no field) -> search", () => {
  const r = classifyCommit({
    type: "url-search",
    pageUrl: "https://www.youtube.com/results?search_query=lofi+hip+hop",
    navUrl: "https://www.youtube.com/results?search_query=lofi+hip+hop",
  });
  assert.equal(r.kind, "search");
  assert.equal(r.text, "lofi hip hop");
  assert.equal(r.host, "youtube.com");
});

test("classifyCommit: Enter in a plain search input on an arbitrary site", () => {
  const r = classifyCommit({
    type: "enter",
    pageUrl: "https://forum.example.com/",
    field: input({ role: "searchbox", value: "how to reset password" }),
  });
  assert.deepEqual(r, {
    kind: "search",
    text: "how to reset password",
    host: "forum.example.com",
    registrableDomain: "example.com",
  });
});

// F-09: a prompt now needs composer evidence — these use the verified live
// attributes (see the F-09 block below for the full matrix).
test("classifyCommit: AI-assistant prompt on chatgpt.com", () => {
  const r = classifyCommit({
    type: "enter",
    pageUrl: "https://chatgpt.com/c/abc",
    field: {
      tag: "textarea",
      id: "mobile-composer-prompt",
      name: "prompt",
      ariaLabel: "Chat with ChatGPT",
      placeholder: "Ask ChatGPT",
      value: "explain the CAP theorem",
      isContentEditable: false,
    },
  });
  assert.equal(r.kind, "prompt");
  assert.equal(r.text, "explain the CAP theorem");
  assert.equal(r.host, "chatgpt.com");
});

test("classifyCommit: AI-assistant prompt from a contenteditable composer", () => {
  const r = classifyCommit({
    type: "enter",
    pageUrl: "https://claude.ai/chat/1",
    field: {
      tag: "div",
      role: "textbox",
      ariaLabel: "Write your prompt to Claude",
      dataTestId: "chat-input",
      hasComposerAttr: true,
      isContentEditable: true,
      value: "  write a haiku about tests  ",
    },
  });
  assert.equal(r.kind, "prompt");
  assert.equal(r.text, "write a haiku about tests");
});

test("classifyCommit: non-search field is ignored", () => {
  assert.equal(
    classifyCommit({
      type: "submit",
      pageUrl: "https://example.com/contact",
      navUrl: "https://example.com/contact",
      field: input({ name: "message", value: "hello there" }),
    }),
    null,
  );
});

test("classifyCommit: empty / whitespace value is ignored", () => {
  assert.equal(
    classifyCommit({
      type: "enter",
      pageUrl: "https://x.com/",
      field: input({ role: "searchbox", value: "   " }),
    }),
    null,
  );
});

test("classifyCommit: an internal / non-web page url -> null (no host)", () => {
  assert.equal(
    classifyCommit({
      type: "enter",
      pageUrl: "chrome://newtab",
      field: input({ role: "searchbox", value: "anything" }),
    }),
    null,
  );
});

test("classifyCommit: very long text is capped", () => {
  const long = "x".repeat(5000);
  const r = classifyCommit({
    type: "enter",
    pageUrl: "https://x.com/",
    field: input({ role: "searchbox", value: long }),
  });
  assert.equal(r.text.length, 2000);
});

test("regression: normal LinkedIn message field on ?q= page is not a search", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://www.linkedin.com/search/results/people/?q=developer",
    field: {
      tag: "textarea",
      type: "",
      role: "",
      name: "message",
      id: "message-box",
      ariaLabel: "Write a message",
      placeholder: "Write a message",
      value: "Hello, how are you?",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});

test("regression: normal Notion field on ?p= page is not a search", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://www.notion.so/workspace/page?p=123456",
    field: {
      tag: "textarea",
      type: "",
      role: "",
      name: "content",
      id: "block-content",
      ariaLabel: "Write something",
      placeholder: "Write something",
      value: "Project notes",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});

test("regression: normal Amazon field on search-like URL is not a search", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://www.amazon.in/s?k=laptop&page=2",
    field: {
      tag: "input",
      type: "text",
      role: "",
      name: "quantity",
      id: "quantity",
      ariaLabel: "Quantity",
      placeholder: "Enter quantity",
      value: "2",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});

test("regression: WordPress comment field is not a search", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://example.com/blog/article?p=123",
    field: {
      tag: "textarea",
      type: "",
      role: "",
      name: "comment",
      id: "comment",
      ariaLabel: "Leave a comment",
      placeholder: "Leave a comment",
      value: "This is a useful article.",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});

test("regression: textarea on ?q= page is not automatically a search", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://example.com/page?q=test",
    field: {
      tag: "textarea",
      type: "",
      role: "",
      name: "notes",
      id: "notes",
      ariaLabel: "Notes",
      placeholder: "Enter your notes",
      value: "This is a normal note.",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});

test("regression: real Google search field is still detected", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://www.google.com/",
    field: {
      tag: "textarea",
      type: "",
      role: "combobox",
      name: "q",
      id: "searchbox",
      ariaLabel: "Search",
      placeholder: "Search",
      value: "javascript security",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result?.kind, "search");
  assert.equal(result?.text, "javascript security");
});

test("regression: real Bing search field is still detected", () => {
  const result = classifyCommit({
    type: "enter",
    pageUrl: "https://www.bing.com/",
    field: {
      tag: "input",
      type: "search",
      role: "searchbox",
      name: "q",
      id: "sb_form_q",
      ariaLabel: "Search",
      placeholder: "Search the web",
      value: "nodejs security",
      isContentEditable: false,
      inSearchRole: true,
      formHasSearchParam: false,
    },
  });

  assert.equal(result?.kind, "search");
  assert.equal(result?.text, "nodejs security");
});

// --- N-2: name / id are split into word tokens ---------------------------
// Each case sets ONLY the attribute under test, so no other signal (type,
// role, aria-label, placeholder) can make it pass.

test("N-2: search words inside a name / id are recognized", () => {
  assert.equal(looksLikeSearchField(input({ id: "header-search-input" })), true);
  assert.equal(looksLikeSearchField(input({ name: "site_search" })), true);
  assert.equal(looksLikeSearchField(input({ id: "nav-search" })), true);
  assert.equal(looksLikeSearchField(input({ name: "txtSearch" })), true);
  assert.equal(looksLikeSearchField(input({ name: "field-keywords" })), true);
});

test("N-2: short codes count only as the whole name / id", () => {
  assert.equal(looksLikeSearchField(input({ name: "wd" })), true);
  assert.equal(looksLikeSearchField(input({ name: "q" })), true);
  assert.equal(looksLikeSearchField(input({ name: "s" })), true);
  assert.equal(looksLikeSearchField(input({ id: "kw" })), true);
  // A short code as one token among others is not enough.
  assert.equal(looksLikeSearchField(input({ id: "sb_form_q" })), false);
  assert.equal(looksLikeSearchField(input({ name: "items_s" })), false);
});

test("N-2: run-together and camelCase search names still match", () => {
  assert.equal(looksLikeSearchField(input({ id: "searchbox" })), true);
  assert.equal(looksLikeSearchField(input({ id: "searchInput" })), true);
  assert.equal(looksLikeSearchField(input({ name: "search_query" })), true);
  assert.equal(looksLikeSearchField(input({ name: "query" })), true);
  assert.equal(looksLikeSearchField(input({ id: "main-query-input" })), true);
});

test("N-2: words that merely contain 'search' / 'query' do not match", () => {
  assert.equal(looksLikeSearchField(input({ id: "searchable-notes" })), false);
  assert.equal(looksLikeSearchField(input({ name: "searcher" })), false);
  assert.equal(looksLikeSearchField(input({ name: "research_notes" })), false);
  assert.equal(
    looksLikeSearchField(input({ tag: "textarea", type: "", id: "query-editor" })),
    false,
  );
});

test("N-2: descriptive text needs a whole search word", () => {
  assert.equal(
    looksLikeSearchField(input({ ariaLabel: "Searchable notes" })),
    false,
  );
  assert.equal(
    looksLikeSearchField(input({ placeholder: "What's on your mind?" })),
    false,
  );
  assert.equal(
    looksLikeSearchField(input({ placeholder: "Driver's license number" })),
    false,
  );
  assert.equal(looksLikeSearchField(input({ ariaLabel: "Search Amazon" })), true);
  assert.equal(looksLikeSearchField(input({ placeholder: "Search…" })), true);
});

test("N-3: 'Query editor' in placeholder / aria-label is not a search", () => {
  assert.equal(looksLikeSearchField(input({ placeholder: "Query editor" })), false);
  assert.equal(looksLikeSearchField(input({ ariaLabel: "Query editor" })), false);
  assert.equal(
    looksLikeSearchField(input({ tag: "textarea", type: "", ariaLabel: "Query editor" })),
    false,
  );
  // A plain query box described in words still counts.
  assert.equal(looksLikeSearchField(input({ placeholder: "Query" })), true);
  assert.equal(looksLikeSearchField(input({ ariaLabel: "Query input" })), true);
});

test("N-3: aria-label and placeholder are judged separately", () => {
  // "Query" alone is a search label; an unrelated placeholder must not cancel it.
  assert.equal(
    looksLikeSearchField(input({ ariaLabel: "Query", placeholder: "Type here" })),
    true,
  );
});

test("N-2: classifyCommit captures a name-only search box and ignores a look-alike", () => {
  const hit = classifyCommit({
    type: "enter",
    pageUrl: "https://shop.example.com/",
    field: input({ name: "site_search", value: "usb hub" }),
  });
  assert.equal(hit?.kind, "search");
  assert.equal(hit?.text, "usb hub");

  assert.equal(
    classifyCommit({
      type: "enter",
      pageUrl: "https://notes.example.com/?q=old",
      field: input({ id: "searchable-notes", value: "private note" }),
    }),
    null,
  );
});

// --- F-09: AI prompts need composer evidence on an EXACT approved host ------
// Attributes marked "verified" were read from the live sites' code/markup
// (see the F-09 live-DOM audit); "generic" are word rules, not site selectors.

const promptField = (over = {}) => ({
  tag: "textarea",
  type: "",
  role: "",
  name: "",
  id: "",
  ariaLabel: "",
  placeholder: "",
  value: "my question",
  isContentEditable: false,
  inSearchRole: false,
  formHasSearchParam: false,
  dataTestId: "",
  hasComposerAttr: false,
  ...over,
});
const enterOn = (url, field) =>
  classifyCommit({ type: "enter", pageUrl: url, field });
const kindOn = (url, field) => enterOn(url, field)?.kind ?? null;

test("F-09 prompt hosts: exact approved hosts only (no registrable-domain inheritance)", () => {
  assert.deepEqual(
    [...PROMPT_HOSTS].sort(),
    [
      "chat.openai.com",
      "chatgpt.com",
      "claude.ai",
      "copilot.com",
      "copilot.microsoft.com",
      "gemini.google.com",
      "perplexity.ai",
    ],
  );
  // a composer-shaped field on a sibling / sub-domain is NOT a prompt
  const composer = promptField({ id: "ask-input", isContentEditable: true, tag: "div" });
  assert.equal(kindOn("https://docs.perplexity.ai/", composer), null);
  assert.equal(kindOn("https://support.claude.ai/", promptField({ ariaLabel: "Write your prompt" })), null);
  assert.equal(kindOn("https://docs.google.com/", promptField({ ariaLabel: "Write your prompt" })), null);
  // "www." is still the same host
  assert.equal(kindOn("https://www.perplexity.ai/", composer), "prompt");
});

test("F-09 positive (ChatGPT, verified): each composer signal works on its own", () => {
  const url = "https://chatgpt.com/";
  assert.equal(kindOn(url, promptField({ id: "mobile-composer-prompt" })), "prompt");
  assert.equal(kindOn(url, promptField({ name: "prompt" })), "prompt");
  assert.equal(kindOn(url, promptField({ ariaLabel: "Chat with ChatGPT" })), "prompt");
  assert.equal(kindOn(url, promptField({ placeholder: "Ask ChatGPT" })), "prompt");
  // same markup on the legacy host
  assert.equal(
    kindOn("https://chat.openai.com/", promptField({ name: "prompt" })),
    "prompt",
  );
});

test("F-09 positive (Claude, verified): contenteditable and textarea variants", () => {
  const url = "https://claude.ai/new";
  const ce = { tag: "div", isContentEditable: true };
  assert.equal(kindOn(url, promptField({ ...ce, ariaLabel: "Write your prompt to Claude" })), "prompt");
  assert.equal(kindOn(url, promptField({ ...ce, dataTestId: "chat-input" })), "prompt");
  assert.equal(kindOn(url, promptField({ ...ce, hasComposerAttr: true })), "prompt");
  assert.equal(kindOn(url, promptField({ ...ce, role: "textbox", ariaLabel: "Write your prompt to Claude", dataTestId: "chat-input", hasComposerAttr: true })), "prompt");
  // textarea variant seen in the page-load markup
  assert.equal(kindOn(url, promptField({ id: "static-composer-input", dataTestId: "static-composer-input", ariaLabel: "Write your prompt to Claude", placeholder: "How can I help you today?" })), "prompt");
});

test("F-09 positive (Perplexity, verified): id=ask-input, even with a 'search' hint", () => {
  const url = "https://www.perplexity.ai/";
  const ce = { tag: "div", isContentEditable: true, id: "ask-input" };
  assert.equal(kindOn(url, promptField(ce)), "prompt");
  for (const hint of ["Ask anything…", "Type @ for connectors", "Type / for search modes", "Type to search"]) {
    assert.equal(kindOn(url, promptField({ ...ce, placeholder: hint, ariaLabel: hint })), "prompt", hint);
  }
});

test("F-09 positive (generic label rule on Gemini/Copilot — no site selector is verified)", () => {
  for (const url of [
    "https://gemini.google.com/app",
    "https://copilot.com/",
    "https://copilot.microsoft.com/",
  ]) {
    assert.equal(
      kindOn(url, promptField({ tag: "div", isContentEditable: true, ariaLabel: "Write your prompt" })),
      "prompt",
      url,
    );
  }
});

test("F-09 negative (ChatGPT): search chats, rename, custom instructions", () => {
  const url = "https://chatgpt.com/";
  const searchChats = enterOn(url, promptField({ tag: "input", type: "text", placeholder: "Search chats...", value: "budget" }));
  assert.equal(searchChats?.kind, "search"); // a search, never a prompt
  assert.equal(enterOn(url, promptField({ tag: "input", type: "text", value: "Q3 planning" })), null);
  assert.equal(enterOn(url, promptField({ value: "I am a nurse at a clinic" })), null);
  assert.equal(
    enterOn(url, promptField({ ariaLabel: "What would you like ChatGPT to know about you to provide better responses?", value: "likes tea" })),
    null,
  );
});

test("F-09 negative (Claude): project name, conversation search, verification code", () => {
  const url = "https://claude.ai/projects";
  assert.equal(enterOn(url, promptField({ tag: "input", type: "text", value: "Payroll project" })), null);
  assert.equal(enterOn(url, promptField({ tag: "input", type: "text", placeholder: "Search your chats...", value: "salary" }))?.kind, "search");
  assert.equal(enterOn(url, promptField({ tag: "input", type: "text", id: "verification-code", value: "492817" })), null);
});

test("F-09 negative (sub-domain / sibling hosts): help-centre and docs search stay searches", () => {
  const support = enterOn("https://support.claude.ai/", promptField({ tag: "input", type: "search", value: "billing" }));
  assert.equal(support?.kind, "search");
  const docs = enterOn("https://docs.perplexity.ai/", promptField({ tag: "input", type: "search", value: "api keys" }));
  assert.equal(docs?.kind, "search");
});

test("F-09 negative (Gemini / Copilot / Perplexity): unrelated fields are not prompts", () => {
  assert.equal(enterOn("https://gemini.google.com/app", promptField({ tag: "input", type: "text", value: "random" })), null);
  assert.equal(enterOn("https://gemini.google.com/gems", promptField({ ariaLabel: "Instructions", value: "You are my HR assistant" })), null);
  assert.equal(enterOn("https://copilot.com/", promptField({ tag: "input", type: "text", value: "Contoso notes" })), null);
  assert.equal(enterOn("https://www.perplexity.ai/spaces", promptField({ tag: "input", type: "text", placeholder: "Space name", value: "Client research" })), null);
  assert.equal(enterOn("https://www.perplexity.ai/library", promptField({ tag: "input", type: "text", ariaLabel: "Collection name", value: "Reading list" })), null);
});

test("F-09: a plain <input> is never a composer, whatever it is called", () => {
  for (const url of ["https://chatgpt.com/", "https://claude.ai/", "https://www.perplexity.ai/"]) {
    assert.equal(
      enterOn(url, promptField({ tag: "input", type: "text", id: "ask-input", name: "prompt", ariaLabel: "Ask ChatGPT", dataTestId: "chat-input", hasComposerAttr: true })),
      null,
      url,
    );
  }
});

test("F-09: strong search evidence wins over composer evidence", () => {
  const url = "https://www.perplexity.ai/";
  const both = { tag: "div", isContentEditable: true, id: "ask-input" };
  assert.equal(kindOn(url, promptField({ ...both, role: "searchbox" })), "search");
  assert.equal(kindOn(url, promptField({ ...both, inSearchRole: true })), "search");
  // a search label never makes a prompt label
  const sp = enterOn("https://claude.ai/", promptField({ placeholder: "Search prompts", value: "x1" }));
  assert.equal(sp?.kind, "search");
});

test("F-09: bare 'chat' / 'message' labels are not enough", () => {
  const url = "https://chatgpt.com/";
  assert.equal(enterOn(url, promptField({ ariaLabel: "Rename chat" })), null);
  assert.equal(enterOn(url, promptField({ ariaLabel: "Chat name" })), null);
  assert.equal(enterOn(url, promptField({ ariaLabel: "Message" })), null);
});

test("F-09: composer evidence off an approved host does nothing (host gate)", () => {
  assert.equal(enterOn("https://example.com/", promptField({ id: "ask-input", name: "prompt", ariaLabel: "Ask anything" })), null);
});

test("F-09: very long prompt is capped at 8000, search still at 2000", () => {
  const r = enterOn("https://chatgpt.com/", promptField({ name: "prompt", value: "p".repeat(9000) }));
  assert.equal(r.text.length, 8000);
});

// --- F-10: URL evidence is conservative and tied to the actual field --------

test("F-10: SEARCH_PARAMS is exactly the strong set", () => {
  assert.deepEqual([...SEARCH_PARAMS].sort(), ["q", "query", "search_query"]);
});

test("F-10: generic URL parameters are not proof of a search", () => {
  for (const p of ["text", "s", "k", "p", "keywords", "keyword", "search", "wd", "kw", "searchquery"]) {
    assert.equal(urlHasSearchParam(`https://example.com/page?${p}=hello`), null, p);
  }
  // a strong parameter wins even when a generic one comes first in the URL
  assert.equal(urlHasSearchParam("https://example.com/list?p=12&q=shoes"), "shoes");
  assert.equal(urlHasSearchParam("https://example.com/list?q="), null); // empty value
});

test("F-10: URL-change path (no field) records only strong parameters", () => {
  const urlSearch = (qs) =>
    classifyCommit({
      type: "url-search",
      pageUrl: `https://example.com/article${qs}`,
      navUrl: `https://example.com/article${qs}`,
    });
  for (const qs of ["?q=hello", "?query=hello", "?search_query=hello"]) {
    assert.equal(urlSearch(qs)?.text, "hello", qs);
  }
  for (const qs of ["?p=12", "?s=asc", "?text=hello", "?keywords=hello", "?keyword=hello", "?k=hello", "?search=hello", "?wd=hello"]) {
    assert.equal(urlSearch(qs), null, qs);
  }
});

test("F-10: formActionMatchesField — POSITIVE only when the action param IS the field", () => {
  assert.equal(formActionMatchesField("https://x.com/search?q=", "q"), true);
  assert.equal(formActionMatchesField("https://x.com/search?query=", "query"), true);
  assert.equal(formActionMatchesField("https://x.com/results?search_query=", "search_query"), true);
  // value is irrelevant, case is irrelevant, extra params are fine
  assert.equal(formActionMatchesField("https://x.com/search?q=shoes&lang=en", "q"), true);
  assert.equal(formActionMatchesField("https://x.com/search?Q=", "Q"), true);
});

test("F-10: formActionMatchesField — NEGATIVE: generic param, unrelated field, no relation", () => {
  // message / comment form carrying ?text=
  assert.equal(formActionMatchesField("https://x.com/some-page?text=", "message"), false);
  assert.equal(formActionMatchesField("https://x.com/some-page?text=hi", "text"), false); // generic even if names match
  // strong param, but not this field
  assert.equal(formActionMatchesField("https://x.com/search?q=", "message"), false);
  assert.equal(formActionMatchesField("https://x.com/search?query=", "phrase"), false);
  assert.equal(formActionMatchesField("https://x.com/search?query=", "searchTerm"), false); // no name relation; this field is judged on its own name
  assert.equal(formActionMatchesField("https://x.com/search?q=", ""), false);
  assert.equal(formActionMatchesField("https://x.com/search", "q"), false); // action has no such param
  assert.equal(formActionMatchesField("not a url", "q"), false);
  assert.equal(formActionMatchesField("", "q"), false);
});

test("F-10: page URL / generic parameter alone never classifies a field (F-01 stays fixed)", () => {
  const msg = input({ name: "message", value: "see you at 5" });
  for (const qs of ["?q=hello", "?query=hello", "?search_query=hello", "?text=hi", "?s=asc", "?keywords=a", "?p=12"]) {
    for (const type of ["enter", "submit"]) {
      assert.equal(
        classifyCommit({
          type,
          pageUrl: `https://example.com/page${qs}`,
          navUrl: `https://example.com/page${qs}`,
          field: msg,
        }),
        null,
        `${type} ${qs}`,
      );
    }
  }
  // comment / message form posting to a ?text= action: not a search
  assert.equal(
    classifyCommit({
      type: "submit",
      pageUrl: "https://example.com/thread/9",
      navUrl: "https://example.com/post?text=",
      field: input({ name: "message", value: "hello all", formHasSearchParam: false }),
    }),
    null,
  );
});

test("F-10: N-2 / N-3 look-alike and real search names are unchanged", () => {
  for (const n of ["header-search-input", "site_search", "txtSearch", "field-keywords", "wd", "q"]) {
    assert.equal(looksLikeSearchField(input({ name: n })), true, n);
  }
  for (const text of ["Search Amazon", "Search or jump to", "Search query"]) {
    assert.equal(looksLikeSearchField(input({ ariaLabel: text })), true, text);
  }
  assert.equal(looksLikeSearchField(input({ id: "query-box" })), true);
  assert.equal(looksLikeSearchField(input({ id: "query-editor" })), false);
  assert.equal(looksLikeSearchField(input({ id: "searchable-notes" })), false);
  assert.equal(looksLikeSearchField(input({ placeholder: "What's on your mind?" })), false);
  assert.equal(looksLikeSearchField(input({ name: "research_notes" })), false);
});

test("regression: form without explicit action does not inherit page ?q= as a search field", () => {
  const result = classifyCommit({
    type: "submit",
    pageUrl: "https://example.com/article?q=existing",
    navUrl: "",
    field: {
      tag: "input",
      type: "text",
      role: "",
      name: "username",
      id: "username",
      ariaLabel: "Username",
      placeholder: "Enter username",
      value: "john@example.com",
      isContentEditable: false,
      inSearchRole: false,
      formHasSearchParam: false,
    },
  });

  assert.equal(result, null);
});
