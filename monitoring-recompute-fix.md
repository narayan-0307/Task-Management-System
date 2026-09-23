# Monitoring "No activity" — recompute runner not draining in production

## Diagnosis

Raw events arrive (`monitoring_events` = 49) and get queued for derivation
(`monitoring_recompute_queue` = 1 pending), but nothing is derived
(`monitoring_pc_sessions` / `monitoring_user_day_summaries` = 0). The dashboard
reads only the derived tables, so it shows "No monitoring activity".

**Root cause: the derivation was driven only by a `setInterval` background timer,
and the production host suspends it.**

- `monitoringRecomputeRunner.start()` schedules `setInterval` drain loops (every
  30 s) that are `.unref()`'d. On Hostinger (Phusion Passenger) the Node app is
  spun **down when idle** and respawned per request, so a 30 s background loop
  rarely completes a cycle — and the moment it _would_ (a quiet period ≥ 45 s
  after the last event, once the ingest debounce settles) is exactly when
  Passenger has killed the process.
- Contributing: the ingest debounce (`not_before = now + 45 s`) keeps pushing the
  queue row's due-time forward while the agent is active, so whenever the process
  _is_ alive the row isn't due yet; whenever the row _is_ due the process is
  asleep.
- Also possible in this class of failure: a row left in `status = 'running'` by a
  worker that was killed mid-derive is never reclaimed (`claimOne` only looks at
  `'pending'`), and a single hung derive wedges the in-process `draining` lock
  forever.

The derivation logic itself is fine (77 backend tests pass; verified end-to-end
locally against synthetic events → `pc_sessions` + `user_day_summaries` populate).
This was purely a runtime/trigger problem.

## Fix (backend only — no derivation or UI changes)

All in `Task-Manager-Backend`:

| File                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/monitoringRecomputeRunner.js` | • **`kick()`** — fire-and-forget opportunistic drain, called from the event-ingest request path. This is now the primary trigger: every batch of events that reaches the server nudges the queue, independent of the (suspendable) background timer. Never blocks or fails the request; `drainOnce()`'s guard prevents overlap.<br>• **`reclaimStaleRunning()`** — at the top of every drain, rows stuck in `'running'` longer than `MONITORING_RUNNING_STALE_MS` (default 10 min) are returned to `'pending'` so a killed-mid-derive worker can't orphan a day.<br>• **drain-stall watchdog** — if the `draining` lock is held longer than `MONITORING_DRAIN_STALL_MS` (default 3 min) the next caller force-resets it, so one hung derive can't permanently wedge the queue.<br>• **`status()`** — `{ enabled, started, draining, … }` for diagnostics.<br>• Clearer startup log (`DISABLED by MONITORING_RECOMPUTE_RUNNER_ENABLED=false` vs `started`). |
| `controllers/monitoringController.js`   | • `submitMonitoringEvents` calls `monitoringRecomputeRunner.kick()` after a successful ingest.<br>• **New** `triggerMonitoringRecompute` — the `POST /api/monitoring/recompute` handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `routes/monitoringRoute.js`             | **New** `POST /api/monitoring/recompute` (`requireAuth` + `requireRole("owner","admin")`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The background `setInterval` runner is kept as-is — it's now a backstop, not the
only path. `nightlyPass` (provisional-session finalisation) is unchanged.

### `POST /api/monitoring/recompute`

Owner/admin. Body (all optional): `{ date?: "YYYY-MM-DD", agent_id?, user_id? }`.

- With `date`: (re)enqueues that day for the org's agents (or the targeted
  agent/user), **due immediately** (bypasses the debounce).
- Always: bumps every `pending`/`running` row for the org's agents to due-now,
  then runs `drainOnce()`.
- Returns `{ forced_due, runner: status(), queue: [...] }` so you can see whether
  the background runner is `enabled`/`started` and what's left in the queue.

## Deploy & recover (production)

1. **Commit + push + redeploy the backend.**
2. **Restart the Node app** in Hostinger hPanel (so the new code + the kick path
   are live).
3. **Force the stuck day through** — as an owner, call:
   ```
   curl -X POST http://localhost:5000/api/monitoring/recompute \
     -H "Authorization: Bearer <your-JWT>" -H "Content-Type: application/json" -d '{}'
   ```
   (or `-d '{"date":"2026-09-03"}'` for a specific day). The response shows the
   queue draining and `runner.status()`.
4. **Confirm summaries populated:**
   ```sql
   SELECT COUNT(*) FROM monitoring_pc_sessions;         -- was 0, now > 0
   SELECT COUNT(*) FROM monitoring_user_day_summaries;  -- was 0, now > 0
   SELECT status, COUNT(*) FROM monitoring_recompute_queue GROUP BY status;
   ```
5. **Open the dashboard** — the employee cards + day detail now render.
6. **Ongoing:** from here, each agent heartbeat/flush (~every 20–30 s) triggers a
   drain, so new days derive within ~1–2 minutes with no manual step.

### Also check (rules out the simplest cause)

- Is `MONITORING_RECOMPUTE_RUNNER_ENABLED=false` set in the Hostinger env? If so,
  remove it (or set `true`). The `POST /api/monitoring/recompute` response's
  `runner.enabled` field tells you.
- App logs (hPanel → your Node app → logs) should show
  `Monitoring recompute runner started …`. If they show
  `Recompute failed for agent … <error>`, that's a real derive error — send it
  and I'll look; the queue row will be in `status = 'error'` after 5 attempts.

## Tuning knobs (env, all optional)

| Var                                   | Default  |                                                           |
| ------------------------------------- | -------- | --------------------------------------------------------- |
| `MONITORING_RECOMPUTE_RUNNER_ENABLED` | `true`   | set `false` to disable both the timer and the ingest kick |
| `MONITORING_DRAIN_INTERVAL_MS`        | `30000`  | background drain cadence                                  |
| `MONITORING_RECOMPUTE_DEBOUNCE_MS`    | `45000`  | ingest → `not_before` delay                               |
| `MONITORING_RUNNING_STALE_MS`         | `600000` | reclaim orphaned `running` rows after this                |
| `MONITORING_DRAIN_STALL_MS`           | `180000` | force-reset a wedged `draining` lock after this           |

## Verification done locally

- Synthetic events + a `pending` queue row → `drainOnce()` → `monitoring_pc_sessions`
  and `monitoring_user_day_summaries` both populated, queue row consumed.
- Synthetic events + an orphaned `status='running'` row → `POST /api/monitoring/recompute`
  → row reclaimed, day derived, queue empty.
- `POST /api/monitoring/recompute` as `member` role → 403.
- Backend `node --test`: 77/77. Agent: 46/46. Frontend build: clean.
