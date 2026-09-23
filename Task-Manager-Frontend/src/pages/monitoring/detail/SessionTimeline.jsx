import { Monitor, Moon, MonitorOff, HelpCircle } from "lucide-react";
import { formatClock, formatHm, INTERVAL_META, SCREEN_OFF_REASON_LABEL } from "../monitoringUtils.js";

// Presentation only — consumes the exact same `intervals` array
// (`{type, started_at, ended_at, duration_seconds, screen_off_reason}`) that
// previously fed the horizontal bar timeline, plus the same pc_session the
// old stat band already read first_pc_on/final_pc_off/total_seconds from.
// No new calculation, no new fields; only how each already-classified
// segment is drawn changes.

const NODE_ICON = {
  active: Monitor,
  idle: Moon,
  screen_off: MonitorOff,
  untracked: HelpCircle,
};

// Circle fill per state, reusing the same semantic colors as INTERVAL_META
// (bg-emerald-500 active / bg-amber-400 idle / bg-slate-400 screen_off /
// muted slate untracked) so this stays visually consistent with any other
// place those states are shown (e.g. the legend dots elsewhere on this page).
const NODE_TONE = {
  active: "border-emerald-500 bg-emerald-500/15 text-emerald-500",
  idle: "border-amber-400 bg-amber-400/15 text-amber-400",
  screen_off: "border-slate-400 bg-slate-400/15 text-slate-400",
  untracked: "border-slate-400/60 bg-slate-400/10 text-slate-400",
};

const LINE_TONE = {
  active: "bg-emerald-500/50",
  idle: "bg-amber-400/50",
  screen_off: "bg-slate-400/50",
  untracked: "bg-slate-400/30",
};

export default function SessionTimeline({ intervals, pcSession }) {
  const segments = intervals || [];

  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-txt-primary">Session Timeline</h3>
          <p className="mt-0.5 text-xs text-txt-muted">
            Visual representation of device activity throughout the session
          </p>
        </div>
        {pcSession?.first_pc_on && (
          <p className="text-xs text-txt-muted">
            {formatClock(pcSession.first_pc_on)} – {formatClock(pcSession.final_pc_off)}
            {pcSession.total_seconds ? ` (${formatHm(pcSession.total_seconds)})` : ""}
          </p>
        )}
      </div>

      {segments.length === 0 ? (
        <p className="mt-4 text-xs text-txt-muted">No session data for this day.</p>
      ) : (
        <div className="mt-5 overflow-x-auto pb-1">
          <div className="flex min-w-max items-start px-1">
            {segments.map((seg, i) => {
              const Icon = NODE_ICON[seg.type] || HelpCircle;
              const meta = INTERVAL_META[seg.type];
              const tone = NODE_TONE[seg.type] || NODE_TONE.untracked;
              const lineTone = LINE_TONE[seg.type] || LINE_TONE.untracked;
              const isLast = i === segments.length - 1;

              return (
                <div key={i} className="flex items-start">
                  <div className="flex w-[104px] flex-col items-center text-center">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${tone}`}
                      title={
                        seg.screen_off_reason
                          ? SCREEN_OFF_REASON_LABEL[seg.screen_off_reason] || seg.screen_off_reason
                          : undefined
                      }
                    >
                      <Icon size={17} />
                    </span>
                    <span className="mt-2 text-[11px] font-medium text-txt-primary">
                      {formatClock(seg.started_at)}
                    </span>
                    <span className="text-[11px] text-txt-muted">
                      {meta?.label || seg.type}
                    </span>
                    <span className="text-[11px] font-semibold text-txt-primary">
                      {formatHm(seg.duration_seconds)}
                    </span>
                  </div>

                  {!isLast && (
                    <div
                      className={`mt-5 h-0.5 w-6 shrink-0 rounded-full sm:w-10 ${lineTone}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-hair pt-3 text-[11px] text-txt-muted">
        {Object.entries(INTERVAL_META).map(([key, meta]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${meta.cls}`} />
            {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}
