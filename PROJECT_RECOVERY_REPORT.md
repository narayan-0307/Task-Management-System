# Task Management System
# Post-15-Day Development Recovery Report

Generated 2026-09-16 via static, read-only audit (no code, schema, or environment changes were made). Sources: full repo read, `git log`/`git show`/`git reflog`/`git diff --stat`, the other developer's own changelog docs at the repo root (`new-change.md`, `phase3-changes.md`, `phase4-changes.md`, `phase5-changes.md`, `content-consent-flow.md`, `monitoring-recompute-fix.md`, `docs/DEPLOYMENT.md`), a Vite production build, and `node --test` runs for the backend and agent test suites.

---

## 1. Executive Summary

The codebase is in **substantially better shape than "showing errors and unexpected behavior" would suggest**: the frontend builds cleanly (`npm run build`, zero errors), the backend test suite passes 77/77 (per the developer's own logs; not re-run here to avoid touching a real DB), the agent test suite passes **132/132**, and the extension's tests pass **12/12**. No broken imports, no dangling references to deleted code, no migration/model dependency-order problems that would break a fresh `db:migrate`.

The real issues are not build breakage — they are **one live legal/compliance discrepancy, one probably-live security regression (`SESSION_SECRET`), a fully-open CORS policy, an unauthenticated static file share, and several pieces of documentation that no longer match the code**. There is also a documented-and-fixed production outage (2026-09-03) and a documented-and-fixed "monitoring shows no activity" production bug — both already resolved in code, but worth confirming they're actually deployed.

**Top-line finding requiring immediate attention:** `CONTENT_CAPTURE_LEGALLY_APPROVED` in `Task-Manager-Backend/config/contentCaptureGate.js` is currently `true` on `HEAD`, and `LIVE_SCREEN_LEGALLY_APPROVED` is also `true`. Every changelog document in the repo says these are `false`/closed. This needs a human legal/compliance decision before anything else in this report is acted on.

---

## 2. Current Architecture

- **Task-Manager-Backend** — Node.js + Express + Sequelize (MySQL) + Socket.IO + Passport (JWT + Google OAuth). `controllers/`, `routes/`, `services/`, `middleware/`, `utils/`, `config/`, `models/` (32 models), `migrations/` (44 files), `uploads/` (local disk, static-served).
- **Task-Manager-Frontend** — React + Vite + Tailwind, React Router v6, Context API (no Redux), `socket.io-client` singleton, Axios client with `VITE_API_URL`-derived base.
- **Task-Monitoring-Agent** — Electron desktop app. Activity/idle tracking, a derived-events pipeline, content capture (search/prompt), Live Screen (WebRTC), one-shot Screenshot capture, and a native-messaging bridge to the browser extension.
- **Task-Monitoring-Extension** — Manifest V3 browser extension (Chrome/Edge), content script + background service worker + native messaging host installer scripts.
- **Deployment** — Backend + frontend on Railway (per `docs/DEPLOYMENT.md`, currently untracked in git); backend also has evidence of an earlier Hostinger/Passenger deployment (see §6, §19). Agent is distributed as a locally-built Windows installer.

Core pre-existing modules (tasks, projects, subtasks, comments, attachments, notifications, Q&A/mentions, organizations/invitations, auth) were **not** touched by any agent's investigation and show no regression signal from the recent work — they are structurally isolated from the monitoring subsystem.

---

## 3. Git/Development Changes

**The "15-day absence" cannot be confirmed from commit timestamps.** `git log` shows continuous activity from 2026-08-11 to 2026-09-06 (HEAD at `84b7fbd`) with no gap larger than ~3 days anywhere in that range. Two candidate "gaps" exist (`872c446`→`68f59df`, ~2d19h; `9c0ffa8`→`460a3dc`, ~2d20h) but neither is 15 days. **Cannot be confirmed from the available code/history** whether the 15-day absence happened outside this commit timeline, was squashed, or if author dates don't reflect real elapsed time.

Using `872c446` ("Redesign registration and invitation-acceptance pages", 2026-08-30) as the reference point for "before the recent development phase," here is what changed through HEAD:

| Subproject | Files touched | Insertions | Deletions |
|---|---|---|---|
| Task-Manager-Backend | 69 | +10,140 | −238 |
| Task-Monitoring-Agent | 51 | +6,539 | −105 |
| Task-Manager-Frontend | 13 | +2,450 | −630 |
| Task-Monitoring-Extension (new) | 12 | +1,047 | 0 |

This was almost entirely **additive** (new subsystems), not refactoring of existing code — consistent with the low regression risk found in §12/§18.

**No dependency additions** were made for any of the new crypto/WebRTC/UI-automation/native-messaging functionality — it's all hand-rolled against Node's built-in `crypto` and Windows APIs (confirmed via `package.json` diffs in all four subprojects).

**Git hygiene / repo-state findings:**
- `developer` is **30–32 commits ahead of every remote** (`origin`, `tms`, `personal/main`) with nothing pushed. All of the Live Screen / Screenshot / Content-Capture / Extension work exists **only on this machine**. No evidence of force-push, rebase, or history rewriting (reflog is clean, fully linear).
- `Task-Monitoring-Agent.zip` (76 KB, stale — older than the current `Task-Monitoring-Agent/` folder) is **tracked in git**, added in commit `68f59df`. It's a committed build artifact, not gitignored.
- `docs/DEPLOYMENT.md` is untracked (never `git add`-ed).
- The `Task-Monitoring-Agent/` folder's gitignore status is fine — it was deliberately un-ignored in `460a3dc` and is fully tracked (67 files).
- **Migration backdating confirmed**: `20260826000000-create-monitoring-agents.js` and `20260826000001-create-monitoring-enrollments.js` carry Aug-26 filename timestamps but were actually committed on **2026-08-30** in `8dbee13` ("Add missing create migrations for monitoring_agents and monitoring_enrollments") — retroactively inserted ahead of migrations that already depended on those tables. The end state is internally consistent (no broken FK order), but this is exactly the "migration added out of order" pattern worth knowing about if `SequelizeMeta` on any real database doesn't match this file layout.

---

## 4. Recently Added Functionality

- **Derived monitoring pipeline**: `monitoring_events` → recompute queue → `monitoring_pc_sessions` / `monitoring_user_day_summaries`, replacing raw per-poll `monitoring_activities` rows. New tables, new derivation service, new recompute-runner with an ingest-triggered "kick" (see §6).
- **Display-power-based idle detection**: replaced keyboard/mouse-inactivity idle with a persistent Windows power-notification watcher (`displayPowerWatcher.js`), folded through `screenReducer.js` with lock/sleep/reboot reason precedence.
- **Agent management**: `GET /api/monitoring/agents`, `POST /api/monitoring/agents/:id/revoke`, `ManageDevicesModal.jsx` UI.
- **Content capture** (search terms / AI prompts from monitored PCs): consent flow, blocklist (hardcoded + DB-tunable), AES-256-GCM encryption at rest, short retention with a daily sweep job, audited restricted-access read endpoint. Gated (in principle) by `CONTENT_CAPTURE_LEGALLY_APPROVED`.
- **Task-Monitoring-Extension**: a new browser extension + native-messaging bridge, extending content capture to browser form fields beyond what the desktop UI-Automation reader alone could see.
- **Live Screen**: real-time WebRTC peer-to-peer screen viewing, signaled over the existing Socket.IO channel, gated by `LIVE_SCREEN_LEGALLY_APPROVED` + org/consent settings.
- **Standalone Screenshot capture**: one-shot capture, relayed through the backend in-memory (see correction in §8) but never persisted.
- **Registration/invitation redesign**: `AuthShell`-based `Register`/`AcceptInvitation` pages (commit `872c446`, before the monitoring work).

---

## 5. Recently Modified Functionality

- `activitySession.js` / `tracker.js`: session-boundary logic changed from window-title-keyed to application+domain-keyed (fixes over-fragmented activity rows).
- `monitoringUtils.js` (frontend): the legacy client-side aggregation helpers (`groupByEmployee`, `groupByApplication`, `summarise`, `deriveStatus`, `ACTIVITY_TYPES`, `TYPE_META`) were **fully removed** in the move to derived-data endpoints — **verified clean**, no dangling importers (see §12).
- `config/config.js` (backend): production DB config changed from throw-on-missing-`PROD_DB_*` back to a non-throwing fallback to `DB_*`, after this exact strictness caused a real production outage on 2026-09-03 (Hostinger/Passenger, surfaced to users as a misleading CORS error on login). **Verified the fix is actually in place on HEAD.**
- `monitoringRecomputeRunner.js`: added an ingest-triggered `kick()` so derivation isn't solely dependent on a `setInterval` that a serverless/idle-suspending host (Hostinger/Passenger) could starve. This was a real production bug ("Monitoring — No activity") with its own root-cause writeup (`monitoring-recompute-fix.md`).
- Legacy `/activities` endpoints: frozen (Deprecation/Sunset headers, rate-limited warning log) but not removed; `monitoring_activities`/`monitoring_enrollments` tables and models are untouched and still queryable.

---

## 6. Current Errors

**No build or test breakage was found.** Specifically:
- `Task-Manager-Frontend`: `npm run build` → **succeeds, 0 errors** (Vite 5.4.21, 2013 modules, one advisory-only "chunk >500kB" warning).
- `Task-Monitoring-Agent`: `node --test` → **132/132 pass**.
- `Task-Monitoring-Extension`: `node --test` → **12/12 pass**.
- `Task-Manager-Backend`: not re-executed here (would require a live DB connection, avoided per the read-only mandate), but the developer's own changelogs report 77/77 passing as of the last phase, and static review found no structural defect that would fail it.

So: whatever "errors and unexpected behavior" prompted this audit are **most likely one or more of**: (a) the already-diagnosed production outage from 2026-09-03 (config throw) — confirm it's actually redeployed; (b) the already-diagnosed "Monitoring shows no activity" production issue — confirm the `kick()` fix and `MONITORING_RECOMPUTE_RUNNER_ENABLED` are live; (c) the open legal gate (§7 below) causing unexpected agent behavior (consent prompts, content capture attempts) that looks like a "bug" but is actually the gate being open; (d) something environment-specific (missing `.env` vars — see §15) that only manifests at runtime, not at build/test time; or (e) something outside what this audit could observe (cannot be confirmed from the available code/history).

---

## 7. Error Root Cause Analysis

### 7.1 — CONTENT_CAPTURE_LEGALLY_APPROVED is `true`, contradicting all documentation (Critical / needs a human decision)
- **File**: `Task-Manager-Backend/config/contentCaptureGate.js:32`.
- **Fact**: `git log -p --follow` shows this flag flipped `false→true→false→true` across four commits on 2026-09-03/04, ending on `1821a2d` ("Open the content-capture legal gate for the widened all-site scope") with the value **`true`**, and it has not changed since (2 days before HEAD).
- **Documentation says otherwise**: `content-consent-flow.md`, `phase4-changes.md`, `phase5-changes.md` all assert it's `false`/closed — but each was committed **before** the final flip and was never updated afterward.
- **Why it isn't fully "live" in practice**: `contentCaptureAllowed()` also requires `MONITORING_CONTENT_KEYS`/`MONITORING_CONTENT_KEY_ACTIVE` to be set (they are absent from `.env` and not even documented in `.env.example`) and a per-org `content_capture_enabled` row. So no content is actually being captured today — but the interlock the docs describe as closed is open, and turning on the encryption keys or an org setting without re-checking this flag would silently start capture for consented users.
- **Related, same pattern**: `LIVE_SCREEN_LEGALLY_APPROVED` (`config/liveScreenGate.js:26`) is also `true`.
- **Recommendation**: get explicit confirmation from whoever has legal/compliance authority on whether `1821a2d` was an authorized decision. If not, revert the flag to `false` and correct the stale docs either way.

### 7.2 — `SESSION_SECRET` missing from the live `.env` (High)
- **File**: `Task-Manager-Backend/index.js:47` — `secret: process.env.SESSION_SECRET || "your-secret-key-change-this"`.
- **Fact**: `SESSION_SECRET` is documented in `.env.example` but **absent from the real `.env`**. The app is therefore running Passport's session cookie signed with a public, hardcoded fallback string.
- **Impact**: session/cookie forgery risk if sessions are relied on for anything beyond OAuth handshake state.
- **Recommendation**: set `SESSION_SECRET` in every environment (dev, and whatever production host is currently live) before doing anything else security-sensitive.

### 7.3 — CORS fully open (Medium)
- **File**: `Task-Manager-Backend/index.js:25` — `app.use(cors())` with no origin restriction. `FRONTEND_URL` exists as an env var but is used only for OAuth redirect, not wired into CORS.
- **Recommendation**: restrict to `FRONTEND_URL` (with a small allowlist if multiple environments need access).

### 7.4 — `/uploads` served with no authentication (Medium, pre-existing)
- **File**: `Task-Manager-Backend/index.js:43` — `express.static` over the uploads directory, no auth middleware. Filenames are server-generated and not guessable in practice, but there is no access-control layer — anyone with a URL (e.g., leaked in a shared link or log) can fetch any org's attachment/avatar.
- **Not new** to this recent work, but flagged here since it's part of the same file-serving surface as everything else.

### 7.5 — Documentation/comment drift (Low, but will mislead the next developer)
- `Task-Manager-Backend/config/db.js` still comments that production "will throw" on missing `PROD_DB_*` — the actual code (in `config.js`) no longer does this (fixed for the 2026-09-03 outage). Anyone reading `db.js` in isolation would believe the old, dangerous behavior is still active.
- `Task-Manager-Frontend/src/components/auth/AuthShell.jsx:6` claims `AcceptInvitation` "still uses the older `AuthLayout`" — false; it uses `AuthShell`. `AuthLayout.jsx` is now fully orphaned dead code (zero importers).
- `migrations/20260903120700-create-monitoring-org-settings.js` and other comments still describe the legal gate as "currently false."

---

## 8. Screenshot Functionality Audit

1. **Capture**: agent-side `screenshotController.js` takes a one-shot PNG on server directive.
2. **Storage**: **not persisted anywhere** — `services/monitoringScreenshot.js` relays the decoded buffer through an in-process `EventEmitter` to the requesting Socket.IO viewer in the same tick; only request *metadata* (requester, target, status, timestamps) is kept, matching the `MonitoringScreenshotRequest` model/migration (no image column at all).
3. **Format**: PNG, base64-encoded in transit.
4. **Naming convention**: N/A — never written to disk/DB.
5. **Upload API**: `POST /api/monitoring/agent/screenshot/upload`, agent-credential auth, 20 MB body limit, 15 MB decoded hard cap.
6. **DB record**: metadata-only, as above.
7. **Model/migration**: `MonitoringScreenshotRequest.js` / `20260905120000-create-monitoring-screenshot-requests.js` — consistent with each other.
8. **Frontend display**: `ScreenshotCapture.jsx`, decodes to a `blob:` object URL, properly revoked on close/retry/unmount; 25s client timeout.
9. **Permissions**: retrieval is via Socket.IO only (JWT-verified `socket.user`), scoped through `canViewContent()` (org owner, or an active `monitoring_content_grants` row) — **no unauthenticated or IDOR path found**, because there is no static URL/file to guess.
10. **Deletion**: N/A, nothing is stored.
11. **Association**: request tied to `(organization_id, requester, target user/agent)`.
12. **Electron-captured**: yes.
13. **Sent to backend**: yes, but only relayed, never written to disk/DB/S3.
14. **Correction to the developer's own changelog**: commit `b5a9013` and `phase5`/related docs frame this as *"client-only, no server/storage involved."* That's **not accurate for the current code** — the image data does transit the backend server in memory to reach the socket viewer. The accurate framing is: **"screenshot data passes through the backend in memory but is never persisted."** This should be corrected in team documentation to avoid a future developer believing the backend has zero involvement (e.g., when reasoning about server logs, memory usage, or interception risk on the wire between agent and backend).
15. **Dev vs. production**: no environment-specific branching found in the screenshot code path; should behave identically in both.

---

## 9. Monitoring System Audit

Flow verified end-to-end:

`Electron Agent` → `agentHeartbeat` (agent_uuid+secret, `crypto.timingSafeEqual`) → activity/idle tracked via `displayPowerWatcher.js` + `screenReducer.js` → events buffered locally (`eventQueue.js`, crash-safe JSONL) → `POST /api/monitoring/agent/events` → `monitoringRecomputeRunner.kick()` (ingest-triggered, plus a 30s backstop timer) → `monitoring_recompute_queue` → derivation → `monitoring_pc_sessions` / `monitoring_user_day_summaries` → `GET /api/monitoring/summary` + `/daily` → `Monitoring.jsx` / `MonitoringDayDetail.jsx`.

- **Confirmed connected end-to-end** — no broken links found between any two stages.
- Legacy dual-emit path (`POST /agent/activities` → `monitoring_activities` → `GET /activities`) is frozen (deprecation headers) but functional as a rollback path; default `pipelineMode` is now `"events"` only.
- The 2026-09-03 production "No activity" bug (background timer starved by a Passenger/Hostinger idle-suspend host) has a documented, code-verified fix (`kick()` + stale-row reclaim + drain-stall watchdog) — **confirm this is actually deployed to whatever host is currently serving production**, since the fix's own writeup implies it needed a manual redeploy + one-time `POST /api/monitoring/recompute` to clear a stuck day.
- Poll interval changed from 5s → 15s by default (screen-power transitions are now event-driven, not poll-driven, so this doesn't lose accuracy on that axis) — but this makes the **legacy** `/activities` path coarser; not a concern for the now-default derived path.

---

## 10. API Inventory

Full inventory produced by the backend audit agent; the monitoring surface (highest risk, most recently changed) is reproduced here:

| Method | Endpoint | Auth | Role | Controller | DB | Purpose |
|---|---|---|---|---|---|---|
| POST | /api/monitoring/agents | JWT | owner,admin | enrollEmployeeAgent | monitoring_agents | Create agent + one-time secret |
| GET | /api/monitoring/agents | JWT | owner,admin | listMonitoringAgents | monitoring_agents | List org agents |
| POST | /api/monitoring/agents/:id/revoke | JWT | owner,admin | revokeMonitoringAgent | monitoring_agents | Soft-revoke |
| POST | /api/monitoring/agent/heartbeat | agent creds | — | agentHeartbeat | monitoring_agents | Liveness + capability signals |
| POST | /api/monitoring/agent/activities | agent creds | — | submitMonitoringActivities | monitoring_activities | **Deprecated**, still functional |
| POST | /api/monitoring/agent/events | agent creds | — | submitMonitoringEvents | monitoring_events | Derived-pipeline ingest |
| POST | /api/monitoring/agent/consent | agent creds | — | submitAgentConsent | monitoring_consents | Consent record, not legal-gated |
| POST | /api/monitoring/agent/content | agent creds | — | submitMonitoringContent | monitoring_content_events | §5b ingest; 501/503 per gates |
| GET | /api/monitoring/content | JWT | owner or granted | getMonitoringContent | monitoring_content_events | Audited read, decrypt-on-fly |
| POST/GET | /api/monitoring/agent/livescreen(/signal) | agent creds | — | live-screen handlers | monitoring_live_screen_sessions | WebRTC signaling relay only |
| GET | /api/monitoring/livescreen/diagnostics | JWT | owner,admin | getLiveScreenDiagnostics | — | Precondition report |
| POST | /api/monitoring/agent/screenshot(/upload) | agent creds | — | screenshot handlers | monitoring_screenshot_requests | Metadata only, see §8 |
| GET | /api/monitoring/summary, /daily | JWT | owner,admin | derived-read handlers | monitoring_pc_sessions etc. | Dashboard data |
| POST | /api/monitoring/recompute | JWT | owner,admin | triggerMonitoringRecompute | — | Manual derivation trigger |
| GET | /api/monitoring/consents | JWT | owner,admin | getMonitoringConsentStatus | monitoring_consents | Rollout checklist |
| ~~POST /api/monitoring/enrollments~~ / ~~/agent/enroll~~ | — | — | removed | — | Confirmed 404 (Phase 5) |

**No frontend-calls-nonexistent-endpoint or method/param mismatches found.** No `/api/api/` duplication (verified `VITE_API_URL` has no `/api` suffix and `client.js` appends it exactly once). No localhost URLs left in frontend production code paths (only a documented dev-fallback default in `client.js`). One soft inconsistency: `organizationRoutes.js`'s `POST /invitations` relies on an inline owner/admin check inside the controller rather than route-level `requireRole`, unlike the rest of the API — functionally fine today, but easy to break in a future edit since it's invisible from the route table.

---

## 11. Database / Sequelize Audit

- Every monitoring model has a matching migration; no model references an uncreated column/table.
- FK dependency order is internally correct across the derived-pipeline migrations.
- **Migration backdating** confirmed for `monitoring_agents`/`monitoring_enrollments` creation migrations (see §3) — committed later than their filename timestamp implies, to satisfy dependency order. Functions correctly on a fresh migrate, but could confuse anyone diffing migration history against commit history.
- `monitoring_enrollments` table/model is orphaned (routes removed in Phase 5) but harmless — historical/unused, not referenced anywhere live.
- No renamed-but-not-migrated columns, no foreign keys referencing missing tables, found.
- **Cannot be confirmed from the repo alone**: whether the actual deployed database's `SequelizeMeta` table matches this migration file set (i.e., whether all 44 migrations have actually been applied in production). Recommend running `sequelize-cli db:migrate:status --env production` yourself against the real DB before assuming this is settled — this audit deliberately avoided touching any live database.

---

## 12. Frontend Audit

- **Build**: clean (`npm run build`, 0 errors, one advisory chunk-size warning).
- **Phase 5 monitoring refactor verified clean**: `MonitoringSummary.jsx`, `MonitoringFilters.jsx`, and `MonitoringDrawer.jsx` (referenced in the *earlier* `new-change.md` changelog) genuinely no longer exist in the codebase, and no file imports the removed `monitoringUtils.js` exports (`groupByEmployee`, `groupByApplication`, `summarise`, `deriveStatus`, `ACTIVITY_TYPES`, `TYPE_META`) or the removed `listMonitoringActivities` API function. The earlier changelog's description of `MonitoringDrawer.jsx` is simply stale documentation from a prior phase, not a live bug.
- Route-level auth guarding (`ProtectedRoute.jsx`) is **authentication-only** — role gating for Monitoring device management happens inside `Monitoring.jsx` via `canManageInvitations` (reusing the invitation-management permission tier rather than a dedicated monitoring permission — INFERENCE: worth a product sanity check on whether "can invite" should imply "can manage surveillance devices," even though this is UI-only defense-in-depth and the backend enforces the real check).
- Registration/invitation redesign (`AuthShell`) is structurally sound; the one issue found is the stale `AuthShell.jsx` comment noted in §7.5.
- Screenshot/Live Screen components have correctly matching props at their call sites, use the shared socket singleton, and have no hardcoded URLs.

---

## 13. Backend Audit

See §7, §10, §11 for the substantive findings. Structurally: 15 controllers, 8 route files, clean separation of services (derivation, recompute, content, live-screen, screenshot) as pure-function-plus-thin-DB-wrapper modules, which is why they're independently unit-testable and why 77/77 backend tests reportedly pass. Agent-credential auth (SHA-256 + `timingSafeEqual`) is soundly implemented. No SQL injection risk found (all Sequelize parameterized queries). No debug/test endpoints left mounted.

---

## 14. Electron Agent Audit

- Activity/idle/session logic changes verified to match the changelog exactly (`sameActivity`, `displayPowerWatcher.js`, `screenReducer.js` precedence, `powerMonitor` wiring).
- Content-capture gating verified properly enforced client-side (only started via the heartbeat-driven `applyContentSignal`, no dev/debug bypass found) with a genuine password-field exclusion in `uiaReader.js` (not just documented — implemented).
- Live Screen confirmed genuinely peer-to-peer, not recorded.
- **`agent.config.json` (committed, despite a code comment claiming it's gitignored) currently points `apiBaseUrl` at the live production backend** (`https://task-management-system-production-fc7b.up.railway.app/api`) and carries **stale interval defaults** (`activityPollIntervalSeconds: 5`, `idleThresholdSeconds: 60`) that predate the Phase 3 changes (now 15s/300s in code defaults). Anyone running the agent locally without overriding `AGENT_API_BASE_URL` will post real monitoring data to production; there is no committed localhost/staging config to protect against this.
- Agent credentials (`agentSecret`) are encrypted via Electron's `safeStorage` (OS-backed, e.g. Windows DPAPI) with a genuine fail-closed path if encryption is unavailable — sound design.
- 132/132 agent tests pass; 12/12 extension tests pass.
- `Task-Monitoring-Agent.zip` at the repo root is a stale, tracked binary artifact — flag for cleanup (repo hygiene, not a functional bug).

---

## 15. Environment Configuration Audit

| Variable | .env.example | Real .env | Status |
|---|---|---|---|
| DB_HOST/PORT/NAME/USER/PASSWORD | yes | yes | present |
| PROD_DB_* | yes (optional) | not present | expected in dev; falls back to DB_* (§7 confirms fix is live) |
| JWT_SECRET, JWT_EXPIRES_IN | yes | yes | present |
| SESSION_SECRET | yes | **no** | **MISSING — see §7.2** |
| FRONTEND_URL | yes | yes | present, but not wired into CORS |
| GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL | yes | yes | present |
| MONITORING_CONTENT_KEYS | **not documented in .env.example at all** | not present | MISSING — content capture inert on this axis, but also undiscoverable from the example file |
| MONITORING_CONTENT_KEY_ACTIVE | not documented | not present | MISSING |
| LIVE_SCREEN_ICE_SERVERS (+ related) | yes (optional) | not checked/likely absent | affects Live Screen connectivity across networks (STUN-only limits real-world use — see the changelog's own "production ICE guidance" note) |
| Frontend: VITE_API_URL | — | present, correctly shaped (no `/api` suffix) | fine |
| Agent: apiBaseUrl (agent.config.json) | — | **points at production** | see §14 |

---

## 16. Dependency Audit

No new npm dependencies were introduced for any of the new monitoring/content/live-screen/screenshot/extension functionality in any of the four subprojects — all built on Node's built-in `crypto`, Electron's built-ins, and hand-rolled PowerShell/WinAPI probes. This is a **low supply-chain-risk** way to have built these features. `bcrypt` and `bcryptjs` both appear as backend dependencies (INFERENCE: possibly redundant — not chased to every call site in this audit; worth a quick grep before removing either).

---

## 17. Security Findings

| Severity | Location | Problem | Impact | Recommendation |
|---|---|---|---|---|
| Critical* | `config/contentCaptureGate.js:32`, `config/liveScreenGate.js:26` | Legal gates are `true` while all documentation says `false` (*severity reflects legal/compliance exposure, not a code exploit) | Undocumented readiness to capture employee search terms/AI prompts and screen content once keys/org-settings are added | Get explicit sign-off before any further config change; correct docs either way |
| High | `index.js:47` | `SESSION_SECRET` missing from live `.env`, hardcoded fallback in use | Session/cookie forgery risk | Set `SESSION_SECRET` in every environment |
| Medium | `index.js:25` | CORS fully open, no origin allowlist | Any origin can call the API with a valid token | Restrict to `FRONTEND_URL` |
| Medium | `index.js:43` | `/uploads` served statically, no auth | Any attachment/avatar fetchable if the URL leaks | Add an auth-checked download route, or move to signed URLs |
| Low | `services/monitoringContent.js` `readContent()` | Doesn't check `isConfigured()` (encryption keys) the way ingest does | Currently harmless (no rows exist without keys); asymmetric gating could surprise a future maintainer | Add the same check for consistency |
| Low | Browser extension `manifest.json` | `host_permissions: http(s)://*/*`, content script on every page at `document_start` | Technical capability to read any focused field on any page exceeds the stated "search/prompt only" intent; the restriction is enforced only in JS (`detector.js`), not by the manifest | Consider narrowing host permissions to the actual allowlisted domains if the browser API allows it for this use case |
| Informational | `Task-Monitoring-Extension/native-host/install.ps1` | Per-user (non-admin) install, requires manual extension IDs, no enterprise/GPO deployment path | Fine for the documented "single-machine" rollout; won't scale to a fleet without more tooling | Build a managed/silent install path before wider rollout |

---

## 18. Regression Findings

| Feature | Expected | Current | Possible Regression | Files | Severity |
|---|---|---|---|---|---|
| Registration/Invitation | Users can register and accept invites | Verified working, build passes, imports resolve | Stale comment claims wrong shell component | `AuthShell.jsx` | P3 (cosmetic/doc) |
| Monitoring dashboard | Shows aggregated per-employee data | Fully migrated to derived-pipeline endpoints, verified no dangling references | None found | `monitoringUtils.js`, `Monitoring.jsx` | None |
| Legacy `/activities` | Old raw-activity view | Frozen, deprecated, still functional as rollback | None — intentional | `monitoringController.js` | None |
| Production DB boot | Boots even if `PROD_DB_*` unset | Fixed, verified in code | Confirm actually redeployed | `config/config.js` | P1 if not yet redeployed |
| Monitoring derivation on production | Drains queue promptly | Fixed via `kick()`, verified in code | Confirm `MONITORING_RECOMPUTE_RUNNER_ENABLED` is on and fix is deployed | `monitoringRecomputeRunner.js` | P1 if not yet redeployed |
| Session auth | Signed with a real secret | Running on hardcoded fallback | Real, present weakness | `index.js` | P1 |
| Everything else (tasks, projects, Q&A, notifications, auth core) | Unaffected by monitoring work | No agent found any cross-contamination | None found | — | None |

---

## 19. Production/Deployment Risks

- `docs/DEPLOYMENT.md` (untracked) describes a **Railway** deployment target. The `monitoring-recompute-fix.md` root-cause writeup describes the bug happening on **Hostinger (Phusion Passenger)**, and the 2026-09-03 outage note also references Hostinger. **This is a real discrepancy worth resolving**: is production currently on Railway, Hostinger, or was there a migration between the two? Cannot be confirmed from the repo alone — ask directly.
- If still on a Passenger-style idle-suspending host, the `setInterval`-based backstop in `monitoringRecomputeRunner.js` will still be unreliable in general (the `kick()` fix helps a lot but is a mitigation, not a structural fix for a host that suspends the process).
- `agent.config.json` shipping with the production URL baked in (§14) means any locally-run/test agent build will talk to production unless explicitly overridden.
- `.env.example` doesn't document `MONITORING_CONTENT_KEYS`/`MONITORING_CONTENT_KEY_ACTIVE` at all — a deploying admin has no way to discover these are needed for content capture without reading the service code directly.
- File uploads (`/uploads`) on Railway are explicitly documented as ephemeral (wiped on redeploy) unless a Volume is attached — confirm this is handled if attachments matter in production.

---

## 20. Recommended Fix Plan

1. Resolve the legal-gate discrepancy (§7.1) with whoever has authority — this blocks any further monitoring/content work in good conscience.
2. Set `SESSION_SECRET` in every real environment.
3. Restrict CORS to `FRONTEND_URL`.
4. Confirm production is actually running the `config/config.js` DB-fallback fix and the `monitoringRecomputeRunner.kick()` fix (both are in the code but may not be deployed/restarted).
5. Resolve the Railway-vs-Hostinger deployment-target ambiguity.
6. Add `MONITORING_CONTENT_KEYS`/`MONITORING_CONTENT_KEY_ACTIVE` to `.env.example` regardless of the gate decision, so the requirement is discoverable.
7. Fix the stale comments in `config/db.js`, `AuthShell.jsx`, and the org-settings migration.
8. Add auth to the `/uploads` static route (pre-existing, unrelated to this work, but real).
9. Push the 30+ unpushed local commits to a remote once you're satisfied with them (backup risk).
10. Remove `Task-Monitoring-Agent.zip` from version control and add `*.zip` to `.gitignore`; commit `docs/DEPLOYMENT.md`.
11. Update `agent.config.json`'s committed defaults to match current code defaults, and consider not committing a production URL as the default.

---

## 21. Priority Order

- **P0 (blocking)**: none found — the app builds and the core product is not broken.
- **P1 (major)**: §7.1 legal gate decision; §7.2 `SESSION_SECRET`; confirming §6/§9's two production fixes are actually deployed; resolving the Railway/Hostinger ambiguity.
- **P2 (important)**: CORS restriction; `/uploads` auth; `MONITORING_CONTENT_KEYS` documentation; `readContent()` gate-parity; pushing local commits to a remote.
- **P3 (minor)**: stale comments (`db.js`, `AuthShell.jsx`, migration comment); removing the tracked zip; committing `docs/DEPLOYMENT.md`; `agent.config.json` stale defaults; browser-extension host-permission narrowing (defense-in-depth, not an active exploit).

---

## 22. Files Requiring Attention

| Path | Reason | Problem | Priority |
|---|---|---|---|
| `Task-Manager-Backend/config/contentCaptureGate.js` | Legal gate open, contradicts docs | Needs a human decision | P1 |
| `Task-Manager-Backend/config/liveScreenGate.js` | Same pattern | Needs a human decision | P1 |
| `Task-Manager-Backend/index.js` | `SESSION_SECRET` fallback, open CORS, unauthenticated `/uploads` | Three separate hardening items | P1/P2 |
| `Task-Manager-Backend/.env` (live) | Missing `SESSION_SECRET`, `MONITORING_CONTENT_KEYS`, `MONITORING_CONTENT_KEY_ACTIVE` | Config gaps | P1/P2 |
| `Task-Manager-Backend/.env.example` | Doesn't document content-capture key vars | Discoverability gap | P2 |
| `Task-Manager-Backend/config/db.js` | Stale comment describing removed throw behavior | Misleading to future readers | P3 |
| `Task-Manager-Backend/services/monitoringContent.js` | `readContent()` gate asymmetry | Consistency | P2 |
| `Task-Manager-Frontend/src/components/auth/AuthShell.jsx` | Stale comment about `AuthLayout` | Misleading | P3 |
| `Task-Manager-Frontend/src/components/AuthLayout.jsx` | Dead code, zero importers | Cleanup candidate | P3 |
| `Task-Monitoring-Agent/agent.config.json` | Committed with production URL + stale defaults | Risk of dev machine hitting prod | P2 |
| `Task-Monitoring-Agent.zip` (repo root) | Stale tracked binary | Repo hygiene | P3 |
| `docs/DEPLOYMENT.md` | Untracked | Should be committed | P3 |
| `Task-Manager-Backend/migrations/20260826000000-*.js`, `20260826000001-*.js` | Backdated relative to actual commit date | Verify against real DB's `SequelizeMeta` before trusting filename order alone | P2 (verification, not a code change) |

---

## 23. Unknowns / Things That Cannot Be Confirmed

- Whether a genuine 15-day gap in development activity occurred — not visible in commit timestamps.
- Whether the actual production database's `SequelizeMeta` matches all 44 migration files (not queried — no live DB was touched).
- Whether production is currently Railway or Hostinger, or mid-migration between the two.
- Whether the two documented production fixes (DB-config fallback, recompute `kick()`) have actually been redeployed to whatever is currently live.
- Whether `1821a2d` (opening the content-capture legal gate) was an authorized decision or an oversight — only a human with context can resolve this.
- Whether `bcrypt` and `bcryptjs` are both genuinely needed or one is dead weight (not fully traced).

---

## 24. Final Health Summary

**Working**: frontend build; backend structural integrity (models/migrations/routes); agent and extension test suites; core product features (tasks, projects, Q&A, notifications, auth, invitations); the derived monitoring pipeline end-to-end; screenshot/live-screen isolation (no persistence, no IDOR).

**Partially working**: content-capture feature (code-complete and tested, but its legal gate is in an unexpected state relative to documentation — a policy problem, not a code problem); production deployment (two real bugs were diagnosed and fixed in code, but this audit cannot confirm the fixes are live).

**Broken**: nothing found at the build/test level. The concrete, present security weaknesses (`SESSION_SECRET`, CORS, `/uploads` auth) are "broken" in the security sense even though they don't crash anything.

**Unknown**: true state of the production database/migrations; which host is actually serving production; whether recent fixes are deployed; the real story behind the 15-day gap.
