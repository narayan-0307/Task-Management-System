import { ChevronLeft, ChevronRight, ChevronRight as Sep, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../../../components/ui/Button.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { isoDate } from "../monitoringUtils.js";

/**
 * Employee-detail header: breadcrumb, identity + live status, and the date
 * navigator. Purely presentational — `date`/`onDateChange`/`onBack` are the
 * same handlers MonitoringDayDetail already owns (query-param date state,
 * navigate("/monitoring")); nothing here fetches or recomputes anything.
 */
export default function EmployeeDetailHeader({
  name,
  email,
  status,
  date,
  dateLabel,
  onDateChange,
  onShiftDate,
  onBack,
}) {
  return (
    <div className="space-y-3">
      <nav className="flex items-center gap-1.5 text-xs text-txt-muted" aria-label="Breadcrumb">
        <Link to="/monitoring" className="hover:text-txt-primary">
          Monitoring
        </Link>
        <Sep size={12} />
        <Link to="/monitoring" className="hover:text-txt-primary">
          Employees
        </Link>
        <Sep size={12} />
        <span className="text-txt-primary">{name}</span>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold text-txt-primary">{name}</h1>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
          </div>
          <p className="mt-1 text-sm text-txt-muted">{email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-hair">
            <button
              type="button"
              aria-label="Previous day"
              className="p-2 text-txt-muted hover:text-txt-primary"
              onClick={() => onShiftDate(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              value={date}
              max={isoDate()}
              onChange={(e) => e.target.value && onDateChange(e.target.value)}
              className="border-x border-hair bg-transparent px-2 py-1.5 text-xs text-txt-primary focus:outline-none"
              title={dateLabel}
            />
            <button
              type="button"
              aria-label="Next day"
              disabled={date >= isoDate()}
              className="p-2 text-txt-muted hover:text-txt-primary disabled:opacity-40"
              onClick={() => onShiftDate(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <Button variant="secondary" size="sm" icon={ArrowLeft} onClick={onBack}>
            Back to employees
          </Button>
        </div>
      </div>
    </div>
  );
}
