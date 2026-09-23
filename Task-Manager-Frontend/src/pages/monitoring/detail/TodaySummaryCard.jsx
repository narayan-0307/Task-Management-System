import { Activity, Clock, PlayCircle, Coffee, MonitorOff } from "lucide-react";
import { formatHm } from "../monitoringUtils.js";

/**
 * 2x2 KPI grid sourced straight from the existing pc_session totals
 * (total_seconds / active_seconds / idle_seconds / screen_off_seconds) —
 * the same numbers the old stat-tile band showed, just laid out compactly.
 * "Productivity" is intentionally NOT shown: the app does not calculate it
 * anywhere today, so it is not invented here.
 */
export default function TodaySummaryCard({ pcSession }) {
  const metrics = [
    { icon: Clock, tone: "text-accentblue", value: formatHm(pcSession?.total_seconds), label: "Total" },
    { icon: PlayCircle, tone: "text-emerald-500", value: formatHm(pcSession?.active_seconds), label: "Active" },
    { icon: Coffee, tone: "text-amber-400", value: formatHm(pcSession?.idle_seconds), label: "Idle" },
    { icon: MonitorOff, tone: "text-txt-muted", value: formatHm(pcSession?.screen_off_seconds), label: "Screen Off" },
  ];

  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accentblue-soft text-accentblue">
          <Activity size={14} />
        </span>
        <div>
          <h3 className="text-xs font-semibold text-txt-primary">Today&apos;s Summary</h3>
          <p className="text-[11px] text-txt-muted">Key metrics for today&apos;s session</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-start gap-2">
            <m.icon size={15} className={`mt-0.5 shrink-0 ${m.tone}`} />
            <div className="min-w-0">
              <p className="font-display text-lg font-bold leading-tight text-txt-primary">
                {m.value}
              </p>
              <p className="text-[11px] text-txt-muted">{m.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
