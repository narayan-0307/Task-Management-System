import { useEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { formatClock, formatHm } from "../monitoringUtils.js";

const LOG_INITIAL = 60;

const TONE_DOT = {
  success: "bg-emerald-500",
  warning: "bg-amber-400",
  neutral: "bg-slate-400",
};

// Chronological "Activity Logs" — same rows buildActivityLog() already
// produced (web sessions + non-browser app sessions + idle/screen-off),
// just laid out as Time / Application / Detail / Duration columns.
export default function ActivityLogsPanel({ rows }) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);
  const shown = expanded ? rows : rows.slice(0, LOG_INITIAL);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
          <ScrollText size={13} /> Activity Logs ({rows.length})
        </h4>
        {rows.length > LOG_INITIAL && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-semibold text-accentblue hover:underline"
          >
            {expanded ? "Show less" : "View all"}
          </button>
        )}
      </div>
      <p className="mb-2 text-[11px] text-txt-muted">Real-time activity events from the device</p>

      {rows.length === 0 ? (
        <p className="text-xs text-txt-muted">No activity recorded for this day.</p>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-[560px] overflow-y-auto rounded-lg border border-hair bg-surface-2/40"
        >
          <div className="grid grid-cols-[64px_1fr_48px] gap-2 border-b border-hair px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-txt-muted">
            <span>Time</span>
            <span>Application / Detail</span>
            <span className="text-right">Duration</span>
          </div>
          <ol>
            {shown.map((r, i) => (
              <li
                key={`${r.startMs}-${i}`}
                className="grid grid-cols-[64px_1fr_48px] items-start gap-2 border-b border-hair px-2 py-1.5 text-[11px] last:border-b-0 hover:bg-surface-2"
              >
                <span className="flex items-start gap-1.5 font-mono text-txt-muted">
                  <span
                    className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      TONE_DOT[r.tone] || "bg-slate-400"
                    }`}
                  />
                  {formatClock(r.startMs)}
                </span>
                <span className="min-w-0">
                  <span className="text-txt-primary">
                    {r.app || (r.status === "Idle" ? "Idle" : r.status)}
                  </span>
                  {r.domain && <span className="text-txt-muted"> · {r.domain}</span>}
                  {r.app && r.status !== "Active" && (
                    <span className="text-txt-muted"> · {r.status}</span>
                  )}
                </span>
                <span className="text-right text-txt-muted">{formatHm(r.seconds)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
