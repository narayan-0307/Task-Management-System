// §5b in-app content capture — search queries from ANY website where a search /
// query field can be reliably detected, plus AI-assistant prompts on a small
// set of known assistants. Best-effort: it tolerates "nothing found", never
// throws, and rate-limits its warning so silent breakage (a target web app
// changed its markup) is still noticeable in the log.
//
// What it reads:
//   - the text of the FOCUSED edit control, via Windows UI Automation, ONLY
//     when that control is not a password field (UIA IsPassword) and:
//       * the control looks like a SEARCH / QUERY field (name / automationId /
//         ariaRole / localizedControlType), OR
//       * the foreground site is a known AI assistant (prompt box)
//     and the foreground tab's host is NOT on the blocklist and NOT a
//     private/incognito window.
//   - nothing else. No keystrokes, no page content, no other fields.
//
// The blocklist (banking / payment / healthcare / government) is enforced here
// and again on the server. It is NOT an allowlist — every other site is a
// capture candidate, gated only by search-field detection.
//
// When it emits:
//   - Without a keyboard / form-submit hook, "a query was committed" is
//     inferred. reduceQuery() emits a query when ANY of these happen:
//       * the field clears (was non-empty, now empty), OR
//       * the target changes (host / app / kind), OR
//       * focus leaves the browser, OR
//       * the text sat UNCHANGED for >= STABLE_TICKS polls and then changed
//         (the user stopped typing it — almost always because they submitted),
//         OR
//       * the text changed to a value that is NOT a continuation of the old
//         one (not old+suffix, not old-minus-suffix) — the old value was a
//         separate query.
//     A per-target guard (emittedForKey) prevents emitting the same text twice
//     within one field session. This captures back-to-back searches on the
//     SAME site, which the old "only on clear / target change" rule silently
//     dropped (only the last survived).
//   - A failed host read does NOT discard the pending query — it is held and
//     retried on the next tick.
//
// Everything here is INERT until contentPipeline.setActive(true), which the
// tracker only does when the heartbeat reports content_capture.active === true.

const logger = require("../utils/logger");
const { matchesBlocklist } = require("./contentBlocklistClient");

// Known AI assistants — captured as a "prompt" (unchanged from the original
// allowlist). Keyed by full host; ChatGPT / Claude are also matched at the
// registrable-domain level so any subdomain counts. Google is deliberately NOT
// in the registrable set (mail/docs/… must not be treated as prompts).
const PROMPT_HOSTS = new Set([
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
]);
const PROMPT_REGISTRABLE = new Set(["chatgpt.com", "claude.ai"]);

// Labels for the known assistants (nice-to-have; falls back to the host).
const PROMPT_LABELS = {
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "claude.ai": "Claude",
    "gemini.google.com": "Gemini",
};

const PRIVATE_MARKERS = [/incognito/i, /inprivate/i, /private browsing/i, /private window/i];

// Edit-like control types UIA reports for text inputs.
const SEARCH_CONTROL_TYPES = new Set([
    "ControlType.Edit",
    "ControlType.ComboBox",
]);

// The AI-assistant composer is usually a contenteditable div, which UIA
// reports as ControlType.Document rather than Edit/ComboBox. Only the known
// prompt hosts get this wider allowance — the generic all-site search path
// deliberately does NOT (a random page's contenteditable region named
// "search" is not a query field; see the looksLikeSearchField tests).
const PROMPT_CONTROL_TYPES = new Set([
    "ControlType.Edit",
    "ControlType.ComboBox",
    "ControlType.Document",
]);

// Chromium's own internal AutomationId for its address bar — identical
// across Chrome / Edge / Brave / Opera, since they share the same UI
// toolkit. This is a structural exclusion (this control IS the browser's
// own chrome, not a webpage element), not a text blacklist.
const BROWSER_CHROME_AUTOMATION_IDS = new Set(["omnibox"]);

/** Normalize a UIA string for label-echo comparison. */
function normalizeLabel(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A UIA "value" read is not always real user text: an empty / placeholder-only
 * field (and, notably, the browser's own address bar, whose Value can mirror
 * its accessible Name when nothing meaningful is focused) is often reported
 * back as text IDENTICAL to the control's own name / automationId /
 * localizedControlType. That is the control announcing itself, not something
 * the user typed — reject it regardless of which site it's on. This is the
 * PRIMARY defense against "Search", "Ask anything", "Address and search bar"
 * style false positives; it is semantic (compares the reading against the
 * control's own identity), not a hardcoded blacklist of known-bad strings.
 */
function isOwnLabelEcho(fieldMeta) {
    const text = normalizeLabel(fieldMeta && fieldMeta.text);
    if (!text) return false;
    const labels = [
        fieldMeta && fieldMeta.name,
        fieldMeta && fieldMeta.automationId,
        fieldMeta && fieldMeta.localizedControlType,
    ]
        .map(normalizeLabel)
        .filter(Boolean);
    return labels.some((label) => label === text);
}

// A tokenised name / automationId / localizedControlType is a search field when
// it contains an exact "q" / "kw" token, or a token in / adjacent to the
// search / query / keyword family ("search", "searchbox", "search_query",
// "site-search", "queryInput", ...). "research", "First name", etc. do not match.
function tokenLooksSearchy(token) {
    return (
        /^(search|query|keyword|keywords)$/.test(token) ||
        token.startsWith("search") ||
        token.endsWith("search") ||
        token.startsWith("query")
    );
}

/** Is the focused control a known AI-assistant prompt box for this site? */
function classifyPromptSite(host, registrableDomain) {
    if (host && PROMPT_HOSTS.has(host)) {
        return { kind: "prompt", label: PROMPT_LABELS[host] || host };
    }
    if (registrableDomain && PROMPT_REGISTRABLE.has(registrableDomain)) {
        return {
            kind: "prompt",
            label: PROMPT_LABELS[registrableDomain] || registrableDomain,
        };
    }
    return null;
}

/**
 * Does the focused-control metadata identify a search / query field?
 * @param {{controlType?:string,name?:string,automationId?:string,
 *          ariaRole?:string,localizedControlType?:string}} meta
 */
function looksLikeSearchField(meta) {
    if (!meta || meta.isPassword) return false;
    const ct = meta.controlType || "";
    if (!SEARCH_CONTROL_TYPES.has(ct)) return false;

    const aria = String(meta.ariaRole || "").toLowerCase();
    if (aria === "searchbox" || aria === "search") return true;

    const hay = [meta.name, meta.automationId, meta.localizedControlType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.includes("q") || tokens.includes("kw")) return true;
    return tokens.some(tokenLooksSearchy);
}

/**
 * Decide whether the focused control on `host` is a capture target.
 *   - AI-assistant prompt box  -> { kind:"prompt", label }
 *   - detected search field    -> { kind:"search", label:<host> }
 *   - anything else            -> null
 * Blocklist / private-window checks are the caller's responsibility (done in
 * the tick loop, same as before).
 *
 * @param {string|null} host                full host, e.g. "gemini.google.com"
 * @param {string|null} registrableDomain   e.g. "google.com"
 * @param {object|null} fieldMeta           readFocusedField() result (metadata
 *   PLUS the current .text reading, since the caller has both)
 * @returns {{kind:"search"|"prompt", label:string}|null}
 */
function classifyTarget(host, registrableDomain, fieldMeta) {
    if (!host) return null;

    // The browser's own chrome (address bar, etc.) is never page content,
    // regardless of what its accessible name happens to contain.
    if (fieldMeta && BROWSER_CHROME_AUTOMATION_IDS.has(String(fieldMeta.automationId || "").toLowerCase())) {
        return null;
    }

    // The reading is just the control echoing its own name/placeholder back
    // (empty field, or the address bar) — never real user content.
    if (isOwnLabelEcho(fieldMeta)) return null;

    const prompt = classifyPromptSite(host, registrableDomain);
    if (prompt) {
        // Field detection is still required for prompt hosts: without it, ANY
        // UIA-focused element on e.g. chatgpt.com (a heading, a button, "New
        // chat") would be captured as if it were the composer.
        if (!fieldMeta || fieldMeta.isPassword) return null;
        if (!PROMPT_CONTROL_TYPES.has(fieldMeta.controlType || "")) return null;
        return prompt;
    }

    if (looksLikeSearchField(fieldMeta)) {
        return { kind: "search", label: host };
    }
    return null;
}

/** Heuristic private/incognito detection from the window title. */
function looksPrivate(windowTitle) {
    if (!windowTitle) return false;
    return PRIVATE_MARKERS.some((re) => re.test(windowTitle));
}

// How many consecutive polls the field text must sit unchanged before a
// subsequent change is treated as "the previous value was a committed query".
// At the default 2.5s poll interval this is ~5s of a stable, non-empty search
// box — in practice that means the user submitted it and is now looking at
// results / starting a new query.
const STABLE_TICKS = 2;

/** Is `b` a continuation of `a` (a typed further, or a backspaced)? */
function isContinuation(a, b) {
    if (!a || !b) return false;
    return b.startsWith(a) || a.startsWith(b);
}

/**
 * Query-log reducer. Given the previous capture state and the current reading,
 * decide whether a committed query should be emitted and compute the next
 * state. Emits EVERY distinct committed query (see the module header), not just
 * the last one per field session.
 *
 * @param {{ pending:string, targetKey:string, stableCount?:number, emittedForKey?:string }} prev
 * @param {{ text:string|null, targetKey:string|null }} cur
 * @returns {{ emit:string|null, state:{ pending:string, targetKey:string, stableCount:number, emittedForKey:string } }}
 */
function reduceQuery(prev, cur) {
    const prevPending = prev.pending || "";
    const prevKey = prev.targetKey || "";
    const prevStable = prev.stableCount || 0;
    const prevEmitted = prev.emittedForKey || "";
    const curText = typeof cur.text === "string" ? cur.text.trim() : null;
    const curKey = cur.targetKey || "";

    const flushable = prevPending && prevPending !== prevEmitted ? prevPending : null;

    // Target switched (or focus lost) — flush whatever we had, start fresh.
    if (curKey !== prevKey) {
        return {
            emit: flushable,
            state: {
                pending: curText || "",
                targetKey: curKey,
                stableCount: 0,
                emittedForKey: "",
            },
        };
    }

    // Same target, field cleared -> the user submitted / navigated away.
    if (prevPending && (curText === "" || curText === null)) {
        return {
            emit: flushable,
            state: { pending: "", targetKey: curKey, stableCount: 0, emittedForKey: "" },
        };
    }

    // Same target, text unchanged & non-empty -> it's sitting there; count it.
    if (curText && curText === prevPending) {
        return {
            emit: null,
            state: {
                pending: prevPending,
                targetKey: curKey,
                stableCount: prevStable + 1,
                emittedForKey: prevEmitted,
            },
        };
    }

    // Same target, text changed to a different non-empty value. Was the old
    // value a committed query? Yes if it sat stable long enough (user stopped
    // -> almost certainly submitted), or if the new text is a clean divergence
    // from a non-trivial old value (not a continuation, old value >= 3 chars —
    // so rapid retyping of a 1-2 char fragment doesn't produce a stray row).
    if (curText) {
        const committed =
            Boolean(flushable) &&
            (prevStable >= STABLE_TICKS ||
                (prevPending.length >= 3 && !isContinuation(prevPending, curText)));
        return {
            emit: committed ? flushable : null,
            state: {
                pending: curText,
                targetKey: curKey,
                stableCount: 0,
                emittedForKey: committed ? prevPending : prevEmitted,
            },
        };
    }

    // curText is null but the key didn't change (shouldn't normally happen) —
    // hold everything.
    return {
        emit: null,
        state: {
            pending: prevPending,
            targetKey: curKey,
            stableCount: prevStable,
            emittedForKey: prevEmitted,
        },
    };
}

const WARN_EVERY_MS = 5 * 60 * 1000;
// If a pending query can't be classified for this long (host unreadable the
// whole time, etc.) flush it anyway with the last-known attribution rather than
// hold it forever or lose it on a later reset.
const MAX_PENDING_HOLD_MS = 120 * 1000;
const EMPTY_STATE = { pending: "", targetKey: "", stableCount: 0, emittedForKey: "" };

/**
 * Start the capture loop.
 *
 * @param {object} p
 * @param {object} p.config
 * @param {Function} p.getForeground  async () => { applicationName, windowTitle, host, registrableDomain, isBrowser } | null
 * @param {Function} p.readQueryField async () => { text, isPassword, controlType, name, automationId, ariaRole, localizedControlType } | null
 * @param {Function} p.emit           (item:{app,kind,text,domain}) => void
 * @param {string[]|Function} [p.blocklistPatterns]  patterns, or a function returning them
 * @returns {{ stop:Function }}
 */
function startContentCapture(p) {
    const intervalMs = (p.config.contentPollIntervalSeconds || 2.5) * 1000;
    const resolveBlocklist =
        typeof p.blocklistPatterns === "function"
            ? p.blocklistPatterns
            : () => p.blocklistPatterns;
    let state = { ...EMPTY_STATE };
    // Attribution for the LAST field we were capturing from — kept across state
    // resets so a flush triggered by leaving that field/site still records the
    // right app + host + kind.
    let last = { app: null, domain: null, kind: null };
    let running = false;
    let consecutiveMisses = 0;
    let lastWarnAt = 0;
    let hostMissStreak = 0;
    let lastHostWarnAt = 0;
    let pendingSince = 0; // when the current `state.pending` first appeared

    function noteState(next) {
        const hadPending = Boolean(state.pending);
        state = next;
        if (state.pending && !hadPending) pendingSince = Date.now();
        else if (!state.pending) pendingSince = 0;
    }

    // Flush any pending query, attributing it to the last active field.
    function flushPending(cur) {
        const r = reduceQuery(state, cur);
        noteState(r.state);
        if (r.emit) flush(r.emit, last.app, last.domain, last.kind);
    }

    async function tick() {
        if (running) return;
        running = true;
        try {
            const fg = await p.getForeground();

            // Definitely not in a browser (or nothing is focused) — the user
            // has left; safe to flush whatever was pending.
            if (!fg || !fg.isBrowser) {
                flushPending({ text: null, targetKey: null });
                hostMissStreak = 0;
                return;
            }

            // In a browser, but the tab's host could not be read THIS tick
            // (transient UIA / address-bar miss). Do NOT discard the pending
            // query — hold it and try again next tick. Force it out only if it
            // has been stuck unclassifiable for too long.
            if (!fg.host) {
                hostMissStreak += 1;
                maybeWarnHost(fg.applicationName);
                if (state.pending && pendingSince && Date.now() - pendingSince > MAX_PENDING_HOLD_MS) {
                    flush(state.pending, last.app, last.domain, last.kind);
                    noteState({ ...EMPTY_STATE });
                }
                return;
            }
            hostMissStreak = 0;

            if (
                looksPrivate(fg.windowTitle) ||
                matchesBlocklist(fg.host, resolveBlocklist())
            ) {
                flushPending({ text: null, targetKey: "" });
                return;
            }

            const field = await p.readQueryField();
            if (!field) {
                consecutiveMisses += 1;
                maybeWarn(fg.host);
                // Can't read — treat as "unchanged", don't lose pending.
                return;
            }
            consecutiveMisses = 0;

            if (field.isPassword) {
                // Never touch a password field. Flush any prior pending.
                flushPending({ text: null, targetKey: "" });
                return;
            }

            const target = classifyTarget(fg.host, fg.registrableDomain, field);
            if (!target) {
                // Focused control is not a search / prompt field — flush prior.
                flushPending({ text: null, targetKey: "" });
                return;
            }

            const key = `${fg.applicationName}|${fg.host}|${target.kind}`;
            const r = reduceQuery(state, { text: field.text, targetKey: key });
            noteState(r.state);
            if (r.emit) flush(r.emit, last.app, last.domain, last.kind);
            last = { app: fg.applicationName, domain: fg.host, kind: target.kind };
        } catch (err) {
            logger.warn(`Content capture tick failed: ${err.message}`);
        } finally {
            running = false;
        }
    }

    function flush(text, app, domain, kind) {
        const value = String(text || "").trim();
        if (value.length < 2 || value.length > 2000) return;
        try {
            p.emit({
                app: app || "Browser",
                kind: kind === "prompt" ? "prompt" : "search",
                text: value,
                domain: domain || null,
            });
        } catch (err) {
            logger.warn(`Content emit failed: ${err.message}`);
        }
    }

    function maybeWarn(host) {
        if (consecutiveMisses < 5) return;
        const now = Date.now();
        if (now - lastWarnAt < WARN_EVERY_MS) return;
        lastWarnAt = now;
        logger.warn(
            `Content capture: ${consecutiveMisses} consecutive UIA misses on ${host} — ` +
            `the focused element could not be read.`,
        );
    }

    // Distinct from maybeWarn(): this fires when the browser is foreground but
    // the ADDRESS BAR / host can't be read at all, which aborts capture for the
    // tick before any field is even looked at. Previously silent.
    function maybeWarnHost(appName) {
        if (hostMissStreak < 3) return;
        const now = Date.now();
        if (now - lastHostWarnAt < WARN_EVERY_MS) return;
        lastHostWarnAt = now;
        logger.warn(
            `Content capture: ${hostMissStreak} consecutive address-bar reads failed for ` +
            `${appName || "a browser"} — the active site could not be identified, so capture ` +
            `is paused until it recovers.`,
        );
    }

    tick();
    const timer = setInterval(tick, intervalMs);
    if (timer.unref) timer.unref();

    return {
        stop() {
            clearInterval(timer);
            // Flush a final pending value on a clean stop (unless it was already
            // emitted for this field session).
            if (state.pending && state.pending !== state.emittedForKey) {
                flush(state.pending, last.app, last.domain, last.kind);
            }
        },
        // Test seam: run one poll synchronously (the loop is otherwise driven by
        // the interval). Not used in production.
        _tick: tick,
    };
}

module.exports = {
    PROMPT_HOSTS,
    PROMPT_REGISTRABLE,
    classifyPromptSite,
    looksLikeSearchField,
    isOwnLabelEcho,
    classifyTarget,
    looksPrivate,
    reduceQuery,
    startContentCapture,
};
