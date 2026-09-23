// Website/domain detection for supported desktop web browsers (Step 17).
//
// When the active foreground application is a supported browser, this module
// reads ONLY the browser's address-bar value via Windows UI Automation
// (the same accessibility API screen readers use) and normalizes it.
//
// Two views of the same address-bar reading are exposed:
//   - normalizeDomain()  -> the registrable domain ("youtube.com"). Used by the
//                           activity/events pipeline (browser_state) so website
//                           sessions group the way they always have.
//   - normalizeHost()    -> the full host ("gemini.google.com"). Used by §5b
//                           content capture so a captured search/prompt is
//                           attributed to the exact site, not collapsed to the
//                           registrable domain.
//
// It deliberately does NOT:
//   - read browser history or history databases
//   - read page contents, cookies, saved passwords or form data
//   - keep full URLs, query strings or path segments
//   - touch the keyboard, mouse, clipboard, screen, camera or microphone
//
// Only the normalized domain/host is returned. Anything uncertain returns null.
// No third-party dependency is used: UIAutomationClient / UIAutomationTypes
// ship with the .NET Framework on every supported version of Windows.

const { execFile } = require("child_process");

// Substrings matched (case-insensitive) against the active application name
// (process description, e.g. "Google Chrome") or process name.
const SUPPORTED_BROWSER_MATCHERS = [
    "chrome",
    "edge",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "chromium",
];

function isSupportedBrowser(applicationName) {
    if (!applicationName || typeof applicationName !== "string") return false;
    const name = applicationName.toLowerCase();
    return SUPPORTED_BROWSER_MATCHERS.some((m) => name.includes(m));
}

// Canonical browser id for the events pipeline ("chrome", "edge", ...). Order
// matters: "Microsoft Edge" is Chromium-based but must not be reported as
// chrome. Returns null when the application is not a supported browser.
const BROWSER_ID_ORDER = [
    "edge",
    "chrome",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "chromium",
];

function canonicalBrowser(applicationName) {
    if (!applicationName || typeof applicationName !== "string") return null;
    const name = applicationName.toLowerCase();
    for (const id of BROWSER_ID_ORDER) {
        if (name.includes(id)) return id;
    }
    return null;
}

// Common two-level public suffixes. Kept small and explicit (no Public Suffix
// List dependency); extend as needed.
const MULTI_PART_TLDS = new Set([
    "co.uk", "org.uk", "gov.uk", "ac.uk", "co.in", "co.jp", "com.au",
    "com.br", "co.nz", "co.za", "com.sg",
]);

/**
 * Normalize a raw address-bar value (a full URL, or a bare host as Chrome
 * shows it) to a lower-case host. Returns null when the value is not a usable
 * web host (search text, internal page, localhost, ...).
 *
 * The leading "www." is stripped; everything else in the host is preserved, so
 * "gemini.google.com" stays "gemini.google.com".
 */
function normalizeHost(raw) {
    if (!raw || typeof raw !== "string") return null;
    let value = raw.trim();
    if (!value) return null;

    // Bare host / host+path without a scheme -> assume http for parsing only.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        value = `http://${value}`;
    }

    let host;
    try {
        const url = new URL(value);
        // Only http(s) pages carry a meaningful website host.
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        host = url.hostname;
    } catch {
        return null;
    }

    if (!host) return null;
    host = host.toLowerCase().replace(/\.+$/, "");
    if (host.startsWith("www.")) host = host.slice(4);

    // Must look like "label.tld" (or deeper) with a real alphabetic TLD.
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null;
    if (host === "localhost") return null;

    return host;
}

/**
 * The registrable domain for an already-normalized host: keep the last two
 * labels, but keep three for the common two-level ccTLDs. "gemini.google.com"
 * -> "google.com"; "bbc.co.uk" -> "bbc.co.uk".
 */
function registrableDomainFromHost(host) {
    if (!host || typeof host !== "string") return null;
    const labels = host.split(".");
    if (labels.length <= 2) return host;
    const lastTwo = labels.slice(-2).join(".");
    if (MULTI_PART_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
    return lastTwo;
}

/**
 * Normalize a raw address-bar value to a lower-case registrable-style hostname
 * such as "youtube.com". Returns null when the value is not a usable web host.
 *
 * Preserved verbatim (composition of normalizeHost + registrableDomainFromHost)
 * so the activity/events pipeline keeps grouping website sessions exactly as
 * before.
 */
function normalizeDomain(raw) {
    const host = normalizeHost(raw);
    if (!host) return null;
    return registrableDomainFromHost(host);
}

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AgentFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
}
"@
$h = [AgentFg]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { '{}'; exit }
$procId = 0
[void][AgentFg]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if (-not $p) { '{}'; exit }
$pn = $p.ProcessName.ToLower()
$browsers = @('chrome','msedge','firefox','brave','opera','vivaldi','chromium')
$ok = $false
foreach ($b in $browsers) { if ($pn -like "*$b*") { $ok = $true } }
if (-not $ok) { '{}'; exit }
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
} catch { '{}'; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
if (-not $root) { '{}'; exit }
$vals = New-Object System.Collections.ArrayList

# Chromium browsers expose the address bar with a stable AutomationId
# ("omnibox"). FindFirst short-circuits on the first match instead of walking
# the whole page's accessibility tree like FindAll does, so this targeted
# lookup avoids the timeout FindAll hits on heavy pages.
$omniboxCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, "omnibox")
$omnibox = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $omniboxCond)
if ($omnibox) {
  $vp = $null
  if ($omnibox.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
    $v = $vp.Current.Value
    if ($v) { [void]$vals.Add([string]$v) }
  }
}

# Fallback: scan every Edit control (previous behavior) when the targeted
# omnibox lookup found nothing — non-Chromium browsers (Firefox) or a UI change.
if ($vals.Count -eq 0) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  foreach ($e in $edits) {
    $vp = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $v = $vp.Current.Value
      if ($v) { [void]$vals.Add([string]$v) }
    }
  }
}

[pscustomobject]@{ values = $vals } | ConvertTo-Json -Compress
`;

function encodeCommand(script) {
    return Buffer.from(script, "utf16le").toString("base64");
}

/** Actually run the PowerShell UIA query once. No caching here. */
function runAddressBarQuery() {
    return new Promise((resolve) => {
        execFile(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                encodeCommand(PS_SCRIPT),
            ],
            { timeout: 10000, windowsHide: true },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(String(stdout).trim() || "{}");
                } catch {
                    resolve(null);
                    return;
                }
                let values = parsed.values;
                if (typeof values === "string") values = [values];
                if (!Array.isArray(values)) {
                    resolve(null);
                    return;
                }
                resolve(values);
            },
        );
    });
}

// This query is expensive (spawns powershell.exe, loads UIAutomationClient,
// walks the WHOLE foreground window's accessibility tree) and is called
// independently by BOTH the activity/domain tracker (tracker.js, every
// activityPollIntervalSeconds) and §5b content capture (contentCaptureRunner.js,
// every contentPollIntervalSeconds — 4s by default, i.e. far more often). Two
// callers landing close together — routine given the independent timers — used
// to mean two full, redundant tree-walks running back to back or concurrently,
// adding real latency/contention on exactly the complex, deeply-nested pages
// (ChatGPT, YouTube, Amazon, ...) where this query is already slowest, making it
// MORE likely to blow past the poll interval or the query's own 10s timeout and
// return null — which silently skips capture entirely for that tick (see
// contentCapture.js's `!fg.host` check). A short cache + in-flight de-dupe below
// removes the redundant spawns without changing the query itself:
//   - in-flight de-dupe: a second caller arriving while a query is already
//     running gets the SAME live result, never a second concurrent spawn.
//   - short TTL cache: a caller arriving just after a successful query reuses
//     that result instead of re-querying from scratch.
// A cached value is reused only while BOTH the foreground application name AND
// the window title are unchanged. The window title changes on every navigation
// (a different page, a different site, and certainly when crossing onto a
// blocklisted bank/health/gov site), so the cache can never serve a stale host
// across a real site change — the blocklist check in contentCapture.js always
// sees the current site. Within one page (title stable) successive polls reuse
// the result and spawn nothing. TTL is a backstop for a page that mutates its
// own title in place.
const QUERY_CACHE_MS = 5000;
let _pending = null;
let _cache = { at: 0, values: null, appName: null, title: null };

/**
 * Run the address-bar UI Automation query, cached/de-duplicated as described
 * above. Resolves [] / null on any failure. Resolves null immediately (no
 * process spawn) when not on Windows or the foreground app isn't a supported
 * browser.
 * @param {{applicationName?:string, windowTitle?:string}|null} active
 * @param {{run?:Function, now?:Function}} [deps]  test seam only
 * @returns {Promise<string[]|null>}
 */
function queryAddressBarValues(active, deps = {}) {
    const run = deps.run || runAddressBarQuery;
    const now = deps.now || Date.now;
    if (!deps.run && process.platform !== "win32") return Promise.resolve(null);
    if (!active || !isSupportedBrowser(active.applicationName)) {
        return Promise.resolve(null);
    }

    const title = active.windowTitle || "";
    const t = now();
    if (
        _cache.values &&
        _cache.appName === active.applicationName &&
        _cache.title === title &&
        t - _cache.at < QUERY_CACHE_MS
    ) {
        return Promise.resolve(_cache.values);
    }
    if (_pending) return _pending;

    _pending = run().then(
        (values) => {
            _pending = null;
            if (Array.isArray(values)) {
                _cache = {
                    at: now(),
                    values,
                    appName: active.applicationName,
                    title,
                };
            }
            return values;
        },
        () => {
            _pending = null;
            return null;
        },
    );
    return _pending;
}

/** Test seam only — clears the module-level query cache/in-flight state. */
function _resetQueryCache() {
    _pending = null;
    _cache = { at: 0, values: null, appName: null, title: null };
}

/**
 * Determine the active website/domain (registrable) for a supported browser.
 * Unchanged contract — the activity/events pipeline depends on this.
 * @param {{applicationName?:string}|null} active
 * @param {{run?:Function, now?:Function}} [deps]  test seam only
 * @returns {Promise<string|null>}
 */
async function getActiveDomain(active, deps) {
    const values = await queryAddressBarValues(active, deps);
    if (!Array.isArray(values)) return null;
    for (const value of values) {
        const domain = normalizeDomain(value);
        if (domain) return domain;
    }
    return null;
}

/**
 * Determine the active website for a supported browser as BOTH the full host
 * and its registrable domain. Used by §5b content capture for correct
 * per-site attribution (e.g. "gemini.google.com" is not collapsed to
 * "google.com").
 * @param {{applicationName?:string}|null} active
 * @param {{run?:Function, now?:Function}} [deps]  test seam only
 * @returns {Promise<{host:string, registrableDomain:string}|null>}
 */
async function getActiveHostInfo(active, deps) {
    const values = await queryAddressBarValues(active, deps);
    if (!Array.isArray(values)) return null;
    for (const value of values) {
        const host = normalizeHost(value);
        if (host) {
            return { host, registrableDomain: registrableDomainFromHost(host) };
        }
    }
    return null;
}

module.exports = {
    getActiveDomain,
    getActiveHostInfo,
    isSupportedBrowser,
    canonicalBrowser,
    normalizeHost,
    normalizeDomain,
    registrableDomainFromHost,
    queryAddressBarValues,
    _resetQueryCache,
    _PS_SCRIPT: PS_SCRIPT, // test seam only — asserts on the embedded selector logic
};
