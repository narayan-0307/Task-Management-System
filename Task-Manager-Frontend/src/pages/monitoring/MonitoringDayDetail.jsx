import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  AppWindow,
  Globe,
  Moon,
  MonitorOff,
  AlertTriangle,
} from "lucide-react";
import AppLayout from "../../components/layout/AppLayout.jsx";
import Badge from "../../components/ui/Badge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import ErrorState from "../../components/common/ErrorState.jsx";
import Spinner from "../../components/common/Spinner.jsx";
import EmployeeDetailHeader from "./detail/EmployeeDetailHeader.jsx";
import MonitoringTabs from "./detail/MonitoringTabs.jsx";
import EmployeeInfoCard from "./detail/EmployeeInfoCard.jsx";
import DeviceInfoCard from "./detail/DeviceInfoCard.jsx";
import TodaySummaryCard from "./detail/TodaySummaryCard.jsx";
import SessionTimeline from "./detail/SessionTimeline.jsx";
import ApplicationsTable from "./detail/ApplicationsTable.jsx";
import ActivityLogsPanel from "./detail/ActivityLogsPanel.jsx";
import RemoteMonitoringSection from "./detail/RemoteMonitoringSection.jsx";
import LiveScreenViewer from "./LiveScreenViewer.jsx";
import ScreenshotCapture from "./ScreenshotCapture.jsx";
import { getMonitoringDay, getMonitoringContent } from "../../api/monitoring.js";
import {
  employeeName,
  formatClock,
  formatHm,
  formatIsoDateLong,
  isoDate,
  shiftIsoDate,
  SCREEN_OFF_REASON_LABEL,
  buildAppWebGroups,
  buildActivityLog,
  deviceLiveStatus,
  overallLiveStatus,
} from "./monitoringUtils.js";

function StatTile({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-4">
      <div className="flex items-center gap-2 text-txt-muted">
        {Icon && <Icon size={15} />}
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">{label}</span>
      </div>
      <p
        className={`mt-1.5 text-xl font-display font-bold ${
          tone === "muted" ? "text-txt-muted" : "text-txt-primary"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-txt-muted">{hint}</p>}
    </div>
  );
}

const PERIOD_LIMIT = 6;

function PeriodList({ title, icon: Icon, rows, emptyText }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, PERIOD_LIMIT);

  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
        {Icon && <Icon size={13} />} {title} ({rows.length})
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-txt-muted">{emptyText}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {shown.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-hair bg-surface-2/50 px-3 py-2 text-xs"
              >
                <span className="text-txt-primary">
                  {formatClock(r.started_at)} – {formatClock(r.ended_at)}
                  {r.screen_off_reason && (
                    <span className="ml-2 text-txt-muted">
                      {SCREEN_OFF_REASON_LABEL[r.screen_off_reason] || r.screen_off_reason}
                    </span>
                  )}
                </span>
                <span className="font-semibold text-txt-primary">
                  {formatHm(r.duration_seconds)}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > PERIOD_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[11px] font-semibold text-accentblue hover:underline"
            >
              {expanded ? "See less" : `See More (${rows.length - PERIOD_LIMIT} more)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function DeviceSection({ device, overlapNote, userId, employeeName, sectionRefs }) {
  const pc = device.pc_session;
  const intervals = device.intervals || [];
  const live = deviceLiveStatus(device);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [screenshotOpen, setScreenshotOpen] = useState(false);

  // Unified Applications & Websites + chronological logs — both derived purely
  // from this device's derived sessions/intervals (no hardcoded list).
  const groups = useMemo(() => buildAppWebGroups(device), [device]);
  const activityLog = useMemo(() => buildActivityLog(device), [device]);

  const idleRows = intervals.filter((i) => i.type === "idle");
  const screenOffRows = intervals.filter((i) => i.type === "screen_off");
  const untrackedRows = intervals.filter((i) => i.type === "untracked");

  return (
    <div className="space-y-6">
      {overlapNote && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          {overlapNote}
        </p>
      )}

      <SessionTimeline intervals={intervals} pcSession={pc} />

      <div
        ref={sectionRefs?.applications}
        className="grid gap-6 rounded-xl border border-hair bg-surface-1 p-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
      >
        <ApplicationsTable groups={groups} />
        <div ref={sectionRefs?.activity}>
          <ActivityLogsPanel rows={activityLog} />
        </div>
      </div>

      {(idleRows.length > 0 || screenOffRows.length > 0 || untrackedRows.length > 0) && (
        <div className="grid gap-6 rounded-xl border border-hair bg-surface-1 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <PeriodList
            title="Idle periods"
            icon={Moon}
            rows={idleRows}
            emptyText="No idle periods."
          />
          <PeriodList
            title="Screen-off periods"
            icon={MonitorOff}
            rows={screenOffRows}
            emptyText="No screen-off periods."
          />
          {untrackedRows.length > 0 && (
            <PeriodList
              title="Untracked gaps"
              icon={AlertTriangle}
              rows={untrackedRows}
              emptyText="None."
            />
          )}
        </div>
      )}

      <div ref={sectionRefs?.remote}>
        <RemoteMonitoringSection
          live={live}
          onOpenLiveScreen={() => setViewerOpen(true)}
          onOpenScreenshot={() => setScreenshotOpen(true)}
        />
      </div>

      <LiveScreenViewer
        open={viewerOpen}
        targetUserId={userId}
        employeeName={employeeName}
        onClose={() => setViewerOpen(false)}
      />
      <ScreenshotCapture
        open={screenshotOpen}
        targetUserId={userId}
        employeeName={employeeName}
        onClose={() => setScreenshotOpen(false)}
      />

      <p className="text-[10px] text-txt-muted">
        active + idle + screen-off + untracked = {formatHm(pc.total_seconds)}
        {pc.reconciliation_delta_seconds
          ? ` (±${Math.abs(pc.reconciliation_delta_seconds)}s rounding)`
          : ""}
      </p>
    </div>
  );
}

// How often the day-detail view silently re-fetches while it is open and the
// browser tab is visible. ~30s keeps captured searches / prompts and derived
// sessions near-live without meaningfully loading the server (one viewer, a
// couple of small GETs per interval).
const AUTO_REFRESH_MS = 30 * 1000;

// §5b captured content. Renders NOTHING unless the server returns 200 — which
// only happens when the legal gate is open AND the viewer is authorized (owner
// or an active grant). A 403 / 501 / any error keeps the panel invisible. Every
// successful load is audited server-side.
const CONTENT_INITIAL = 8;

function ContentPanel({ userId, date, sectionRef }) {
  const [state, setState] = useState({ status: "loading", items: [], via: null });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    // Show the loading state only on a target change, not on the poll — a silent
    // refetch must not make the panel flicker out and back in.
    setState((prev) =>
      prev.status === "ok" ? prev : { status: "loading", items: [], via: null },
    );

    const fetchOnce = () => {
      getMonitoringContent({ user_id: userId, from: date, to: date })
        .then((res) => {
          if (!alive) return;
          setState({
            status: "ok",
            items: res.data?.items || [],
            via: res.data?.access_via || null,
          });
        })
        .catch(() => {
          // Keep a panel that has already rendered; only hide if it never loaded.
          if (alive) setState((prev) => (prev.status === "ok" ? prev : { status: "hidden", items: [], via: null }));
        });
    };

    fetchOnce();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") fetchOnce();
    }, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId, date]);

  if (state.status !== "ok") return null;

  const shown = expanded ? state.items : state.items.slice(0, CONTENT_INITIAL);

  return (
    <section ref={sectionRef} className="rounded-xl border border-hair bg-surface-1 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-txt-primary">
            <Globe size={15} className="text-txt-muted" /> Search &amp; Prompt Content
          </h3>
          <p className="mt-0.5 text-xs text-txt-muted">
            Search queries and AI prompt content (if available)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.via === "grant" && <Badge tone="warning">via grant</Badge>}
          <span className="text-[11px] text-txt-muted">{state.items.length} entries · access logged</span>
          {state.items.length > CONTENT_INITIAL && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] font-semibold text-accentblue hover:underline"
            >
              {expanded ? "Show less" : "View all"}
            </button>
          )}
        </div>
      </div>
      {state.items.length === 0 ? (
        <p className="text-xs text-txt-muted">No captured content for this day.</p>
      ) : (
        <>
          <div className="grid grid-cols-[64px_1fr_auto] gap-3 border-b border-hair pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-txt-muted">
            <span>Time</span>
            <span>Content</span>
            <span>Source</span>
          </div>
          <ul>
            {shown.map((it) => (
              <li
                key={it.id}
                className="grid grid-cols-[64px_1fr_auto] items-start gap-3 border-b border-hair py-2 text-xs last:border-b-0"
              >
                <span className="font-mono text-txt-muted">{formatClock(it.captured_at)}</span>
                <span className="min-w-0 break-words text-txt-primary">
                  {it.undecryptable ? (
                    <em className="text-txt-muted">[unable to decrypt]</em>
                  ) : (
                    it.text
                  )}
                </span>
                <span className="min-w-0 shrink-0 whitespace-nowrap break-words text-txt-muted">
                  {it.kind === "prompt" ? "Prompt" : "Search"}
                  {it.domain ? ` · ${it.domain}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function MonitoringDayDetail() {
  const { userId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const date = searchParams.get("date") || isoDate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Section anchors for MonitoringTabs' scroll-to-section navigation. Only
  // the first device's sections are targeted (the common case is one
  // device); this is pure DOM navigation, no new data or routes.
  const applicationsRef = useRef(null);
  const activityRef = useRef(null);
  const remoteRef = useRef(null);
  const searchRef = useRef(null);
  const sectionRefs = {
    applications: applicationsRef,
    activity: activityRef,
    remote: remoteRef,
    search: searchRef,
  };

  const setDate = useCallback(
    (next) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set("date", next);
        return p;
      });
    },
    [setSearchParams],
  );

  const load = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError("");
      return getMonitoringDay({ user_id: userId, date })
        .then((res) => setData(res.data))
        .catch((err) => {
          // A background refresh that fails leaves the last good view in place.
          if (!silent)
            setError(err.response?.data?.message || "Unable to load the day detail.");
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [userId, date],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Silent auto-refresh while the tab is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const summary = data?.summary || null;
  const devices = data?.devices || [];
  const status = overallLiveStatus(devices);
  const name = employeeName(data?.user);

  const overlapNote =
    summary && summary.multi_device && summary.overlap_seconds > 0
      ? `${formatHm(summary.overlap_seconds)} of concurrent use across ${summary.device_count} devices — per-app totals below can exceed session time.`
      : null;

  return (
    <AppLayout title="Monitoring">
      <div className="space-y-6">
        <EmployeeDetailHeader
          name={name}
          email={data?.user?.email}
          status={status}
          date={date}
          dateLabel={formatIsoDateLong(date)}
          onDateChange={setDate}
          onShiftDate={(delta) => setDate(shiftIsoDate(date, delta))}
          onBack={() => navigate("/monitoring")}
        />

        {!loading && !error && devices.length > 0 && (
          <MonitoringTabs sectionRefs={sectionRefs} />
        )}

        {loading ? (
          <Spinner label="Loading day detail..." />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : devices.length === 0 ? (
          <EmptyState
            icon={MonitorOff}
            title="No monitoring data for this day"
            description={`No agent events were recorded for ${name} on ${formatIsoDateLong(date)}.`}
          />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <EmployeeInfoCard user={data?.user} name={name} />
              {devices.length === 1 && (
                <>
                  <DeviceInfoCard agent={devices[0].agent} live={deviceLiveStatus(devices[0])} />
                  <TodaySummaryCard pcSession={devices[0].pc_session} />
                </>
              )}
              {devices.length > 1 && summary && (
                <div className="rounded-xl border border-hair bg-surface-1 p-4 lg:col-span-2">
                  <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
                    Combined Summary
                    <Badge tone="info">{summary.device_count} devices</Badge>
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatTile icon={AppWindow} label="Total" value={formatHm(summary.span_seconds)} />
                    <StatTile icon={AppWindow} label="Active" value={formatHm(summary.active_seconds)} />
                    <StatTile icon={Moon} label="Idle" value={formatHm(summary.idle_seconds)} />
                    <StatTile
                      icon={MonitorOff}
                      label="Screen off"
                      value={formatHm(summary.screen_off_seconds)}
                    />
                  </div>
                </div>
              )}
            </div>

            {devices.length > 1 &&
              devices.map((d, i) => (
                <div key={d.pc_session.id} className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-txt-muted">
                    Device {i + 1} of {devices.length}
                  </p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <DeviceInfoCard agent={d.agent} live={deviceLiveStatus(d)} />
                    <TodaySummaryCard pcSession={d.pc_session} />
                  </div>
                  <DeviceSection
                    device={d}
                    overlapNote={null}
                    userId={userId}
                    employeeName={name}
                    sectionRefs={i === 0 ? sectionRefs : undefined}
                  />
                </div>
              ))}

            {devices.length === 1 && (
              <DeviceSection
                device={devices[0]}
                overlapNote={overlapNote}
                userId={userId}
                employeeName={name}
                sectionRefs={sectionRefs}
              />
            )}

            <ContentPanel userId={userId} date={date} sectionRef={searchRef} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
