/**
 * Search / AI-prompt detection — PURE logic, no DOM dependency.
 *
 * content.js turns real DOM events into the plain descriptors this module
 * classifies. Keeping the decision here means it is unit-testable without a
 * browser and stays identical to reason about across Chrome / Edge / Firefox.
 *
 * Scope, deliberately narrow (must match the consent notice): this only ever
 * identifies a SEARCH query field or an AI-assistant PROMPT box. It never
 * looks at any other input, never at page content, never at keystrokes outside
 * the field it has identified.
 */

"use strict";

// Approved AI-assistant hosts — matched EXACTLY (normalizeHost already strips a
// leading "www."). A subdomain or sibling site that merely shares a registered
// domain (support.claude.ai, docs.perplexity.ai, any other *.google.com) is NOT
// a prompt host: it goes through the ordinary search rules instead.
// copilot.microsoft.com redirects to copilot.com, so both are listed.
const PROMPT_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "copilot.com",
  "perplexity.ai",
]);

// --- AI prompt-composer evidence --------------------------------------------
// On an approved host a field is a PROMPT only when it positively looks like the
// assistant's composer. Every signal below is either verified against the live
// sites or is a generic word rule (not a site selector):
//   - id="ask-input"                  Perplexity composer          (verified, live JS)
//   - data-testid="chat-input"        Claude composer              (verified, live JS)
//   - data-composer-editor attribute  Claude composer              (verified, live JS)
//   - id / name / data-testid containing the whole word "prompt" or "composer"
//       ChatGPT logged-out composer: id="mobile-composer-prompt", name="prompt"
//       Claude loading composer: id/data-testid="static-composer-input"
//   - aria-label / placeholder phrases (below)
//       ChatGPT "Chat with ChatGPT" / "Ask ChatGPT", Claude "Write your prompt
//       to Claude", Perplexity "Ask anything…"
// No Gemini- or Copilot-specific selector has been verified, so none is
// hard-coded: those hosts are covered only by the generic word rules above.
const PROMPT_ID_EXACT = new Set(["ask-input"]);
const PROMPT_TESTID_EXACT = new Set(["chat-input"]);
const PROMPT_IDENTITY_WORD = /^(prompt|composer)$/;
// Label phrases. Deliberately phrase-shaped, not single words: a bare "chat" or
// "message" would also match "Rename chat" / "Message" feedback boxes.
const PROMPT_LABEL = [
  /\bprompts?\b/, // "Write your prompt to Claude"
  /^ask\b/, // "Ask ChatGPT", "Ask anything…"
  /^message \S/, // "Message <assistant>"
  /^send (a )?message\b/,
  /^chat with\b/, // "Chat with ChatGPT"
];

// Query-string parameters strong enough to mean "this URL is a search".
// Deliberately SMALL. Generic names — p, s, k, text, search, keyword(s), kw, wd
// — are also pagination, sort, post-id, filter and message parameters, so a URL
// carrying one proves nothing about what the user typed; a missed search on a
// site that uses one is the privacy-safe failure. (Those engines' search boxes
// are still caught from the FIELD, e.g. name="wd" / aria-label "Search Amazon".)
const SEARCH_PARAMS = new Set(["q", "query", "search_query"]);

// Whole-word search vocabulary. Matched against COMPLETE tokens only — never
// as a prefix / suffix — so "searchable", "searcher" and "research" don't
// count. A few run-together forms ("searchbox", "queryinput") are listed
// explicitly instead.
const SEARCH_WORD = /^(search(box|bar|field|input|term|terms|text|string|query)?|keywords?)$/;
const QUERY_WORD = /^query(box|field|input|string|text)?$/;

// Short codes that only count when they are the ENTIRE name / id
// (name="q", WordPress name="s", Baidu name="wd" / id="kw").
const SHORT_SEARCH_IDENTITY = /^(q|s|kw|wd)$/;

// Generic field-naming words that may sit next to "query" in a search box's
// name / id ("query-input", "main_query"). Anything else beside it (e.g.
// "query-editor", "query-builder") means it is not a plain search box.
const GENERIC_FIELD_WORDS = new Set([
  "input", "inp", "box", "field", "fld", "text", "txt", "term", "terms",
  "string", "bar", "form", "main", "site", "global", "header", "nav", "top",
  "tb", "sb",
]);

/** Is this single, already-split token a search / query word? */
function tokenLooksSearchy(token) {
  return SEARCH_WORD.test(token) || QUERY_WORD.test(token);
}

/**
 * Split a name / id / label into lower-case word tokens. Handles "-", "_",
 * spaces and other separators, plus camelCase ("txtSearch" -> txt, search).
 */
function splitTokens(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does a name / id value identify the field as a search box? */
function identityLooksSearchy(value) {
  const whole = String(value || "").trim().toLowerCase();
  if (!whole) return false;

  if (SHORT_SEARCH_IDENTITY.test(whole)) return true;

  return tokensLookSearchy(splitTokens(value));
}

/**
 * Shared word rule for name / id AND aria-label / placeholder tokens: any
 * search word counts; "query" only counts when every other token is a
 * generic field word (so "query-editor" / "Query editor" don't).
 */
function tokensLookSearchy(tokens) {
  if (tokens.some((t) => SEARCH_WORD.test(t))) return true;

  return (
    tokens.some((t) => QUERY_WORD.test(t)) &&
    tokens.every((t) => tokenLooksSearchy(t) || GENERIC_FIELD_WORDS.has(t))
  );
}

function normalizeHost(raw) {
  if (!raw || typeof raw !== "string") return null;

  let value = raw.trim();
  if (!value) return null;

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`;
  }

  let host;

  try {
    const u = new URL(value);

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    host = u.hostname;
  } catch {
    return null;
  }

  if (!host) return null;

  host = host.toLowerCase().replace(/\.+$/, "");

  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || host === "localhost") {
    return null;
  }

  return host;
}

function registrableDomain(host) {
  if (!host) return null;

  const labels = host.split(".");

  if (labels.length <= 2) {
    return host;
  }

  const twoLevel = new Set([
    "co.uk",
    "org.uk",
    "gov.uk",
    "ac.uk",
    "co.in",
    "co.jp",
    "com.au",
    "com.br",
    "co.nz",
    "co.za",
    "com.sg",
  ]);

  const lastTwo = labels.slice(-2).join(".");

  return twoLevel.has(lastTwo)
    ? labels.slice(-3).join(".")
    : lastTwo;
}

/**
 * Does this URL's query string carry a STRONG search parameter + value?
 * (SEARCH_PARAMS only: q / query / search_query.)
 */
function urlHasSearchParam(url) {
  try {
    const u = new URL(url);

    for (const [key, val] of u.searchParams.entries()) {
      if (
        SEARCH_PARAMS.has(key.toLowerCase()) &&
        val &&
        val.trim()
      ) {
        return val.trim();
      }
    }
  } catch {
    // not a URL
  }

  return null;
}

/**
 * Is this form's action evidence that THIS field is the search box?
 *
 * Only when the (explicit) action URL names a strong search parameter AND the
 * submitted field is that very parameter: <form action="/search?q="> with
 * <input name="q">. A form that merely carries ?text= / ?s= / ?p= — or a strong
 * parameter that is not this field's name (action "?query=" with
 * name="message") — says nothing about what is typed into the field.
 *
 * Name-based on purpose: the parameter's value is irrelevant (it is usually
 * empty), and no attempt is made to guess other relationships.
 *
 * @param {string} actionHref  absolute URL of the form's explicit action
 * @param {string} fieldName   the field's name attribute
 */
function formActionMatchesField(actionHref, fieldName) {
  const name = String(fieldName || "").trim().toLowerCase();
  if (!name || !SEARCH_PARAMS.has(name)) return false;

  try {
    const u = new URL(actionHref);
    for (const key of u.searchParams.keys()) {
      if (key.toLowerCase() === name) return true;
    }
  } catch {
    // not a URL
  }

  return false;
}

/**
 * @param {object} d
 * @param {"submit"|"enter"|"url-search"} d.type
 * @param {string} d.pageUrl              location.href of the page
 * @param {string} [d.navUrl]             the URL being navigated to
 * @param {object} [d.field]              the committed input/textarea descriptor:
 *   { tag, type, role, name, id, ariaLabel, placeholder, value,
 *     isContentEditable, inSearchRole, inForm, formHasSearchParam,
 *     dataTestId, hasComposerAttr }
 * @returns {{ kind:"search"|"prompt", text:string, host:string,
 *             registrableDomain:string } | null}
 */
function classifyCommit(d) {
  if (!d || typeof d !== "object") return null;

  const host = normalizeHost(d.pageUrl);

  if (!host) return null;

  const reg = registrableDomain(host);

  // --- AI prompt on an approved assistant host ----------------------------
  // Exact host match, and only for a field that is positively the composer.
  // A field with strong SEARCH evidence is a search even here ("Search chats").
  if (
    PROMPT_HOSTS.has(host) &&
    d.field &&
    !hasStrongSearchSignal(d.field) &&
    looksLikePromptComposer(d.field)
  ) {
    const text = promptText(d.field);

    if (text) {
      return {
        kind: "prompt",
        text,
        host,
        registrableDomain: reg,
      };
    }
  }

  // Anything else on an assistant host falls through to the normal search
  // rules — it is never a prompt just because of the host.

  // --- search, from the URL that is being navigated to --------------------
  const fromNav =
    d.type === "url-search"
      ? urlHasSearchParam(d.navUrl || d.pageUrl)
      : null;

  if (fromNav) {
    return {
      kind: "search",
      text: fromNav.slice(0, 2000),
      host,
      registrableDomain: reg,
    };
  }

  // --- search, from a committed field -------------------------------------
  const f = d.field;

  if (!f) return null;

  const value = fieldValue(f);

  if (!value) return null;

  if (!looksLikeSearchField(f, d.navUrl || d.pageUrl)) {
    return null;
  }

  return {
    kind: "search",
    text: value.slice(0, 2000),
    host,
    registrableDomain: reg,
  };
}

function fieldValue(f) {
  if (!f) return "";

  const raw = f.isContentEditable ? f.value : f.value;

  return typeof raw === "string" ? raw.trim() : "";
}

function promptText(f) {
  if (!f) return "";

  const v = fieldValue(f);

  return v && v.length >= 1 ? v.slice(0, 8000) : "";
}

/**
 * Strong, structural SEARCH evidence only: type=search, a search role, a
 * <search>/role="search" ancestor, or a search-word name/id. Descriptive text
 * (aria-label / placeholder) is deliberately NOT included — Perplexity's
 * composer hint says "Type to search" and must stay a prompt.
 */
function hasStrongSearchSignal(f) {
  if (String(f.type || "").toLowerCase() === "search") return true;
  if (f.role === "searchbox" || f.role === "search") return true;
  if (f.inSearchRole) return true;
  return [f.name, f.id].some(identityLooksSearchy);
}

/**
 * Is this field the assistant's prompt composer? (Caller has already checked
 * the host is approved and that the field has no strong search signal.)
 *
 * A plain <input> is NEVER a composer — project names, renames, verification
 * codes, email, collection names and search boxes are all plain inputs. Only a
 * textarea or a contenteditable can be, and then only with positive evidence.
 */
function looksLikePromptComposer(f) {
  const tag = String(f.tag || "").toLowerCase();
  if (!(tag === "textarea" || f.isContentEditable)) return false;
  if (tag === "input") return false;

  const id = String(f.id || "").toLowerCase();
  const name = String(f.name || "").toLowerCase();
  const testId = String(f.dataTestId || "").toLowerCase();

  if (PROMPT_ID_EXACT.has(id)) return true;
  if (PROMPT_TESTID_EXACT.has(testId)) return true;
  if (f.hasComposerAttr === true) return true;

  if (
    [id, name, testId].some((v) =>
      splitTokens(v).some((t) => PROMPT_IDENTITY_WORD.test(t)),
    )
  ) {
    return true;
  }

  // Label phrases — each label judged separately, and a label that mentions
  // search ("Search chats", "Search prompts") never counts as a prompt label.
  return [f.ariaLabel, f.placeholder].some((label) => {
    const text = String(label || "").trim().toLowerCase();
    if (!text) return false;
    if (tokensLookSearchy(splitTokens(text))) return false;
    return PROMPT_LABEL.some((re) => re.test(text));
  });
}

function looksLikeSearchField(f, navUrl) {
  const tag = String(f.tag || "").toLowerCase();
  const type = String(f.type || "").toLowerCase();

  // A password field is never a search field.
  if (type === "password") return false;

  // Only free-text inputs / textareas / contenteditables.
  if (tag === "input") {
    if (!["", "text", "search"].includes(type)) {
      return false;
    }
  } else if (tag !== "textarea" && !f.isContentEditable) {
    return false;
  }

  // Structural signals: type=search, ARIA search role, a <search> /
  // role="search" ancestor, or a search-word name / id (split into tokens).
  if (hasStrongSearchSignal(f)) return true;

  // Descriptive signals: aria-label / placeholder, each checked on its own
  // with the same word rule as name / id. Short codes ("q", "s", "kw") never
  // count here, so "What's …" or "Driver's …" can't match.
  if (
    [f.ariaLabel, f.placeholder]
      .filter(Boolean)
      .some((text) => tokensLookSearchy(splitTokens(text)))
  ) {
    return true;
  }

  // The form's explicit action names a strong search parameter that is THIS
  // field's own name (computed by content.js via formActionMatchesField). An
  // action parameter unrelated to the field never gets here as true.
  if (f.formHasSearchParam) return true;

  // IMPORTANT:
  // Do not classify a normal field just because the CURRENT PAGE URL
  // contains ?q=, ?p=, ?s=, etc.
  //
  // URL-navigation detection is handled separately by classifyCommit()
  // when d.type === "url-search".
  // if (navUrl && urlHasSearchParam(navUrl)) return true;

  return false;
}

module.exports = {
  PROMPT_HOSTS,
  SEARCH_PARAMS,
  normalizeHost,
  registrableDomain,
  urlHasSearchParam,
  formActionMatchesField,
  tokenLooksSearchy,
  splitTokens,
  identityLooksSearchy,
  hasStrongSearchSignal,
  looksLikePromptComposer,
  looksLikeSearchField,
  classifyCommit,
};