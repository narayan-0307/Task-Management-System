import { useState } from "react";
import { AppWindow, Globe, ChevronDown } from "lucide-react";
import { formatClock, formatHm, collapseWithRecent } from "../monitoringUtils.js";

const DOMAIN_LIMIT = 6;
const APP_LIMIT = 7;

// One application row + its nested per-domain breakdown (unchanged grouping
// from buildAppWebGroups — only the row is now columnar instead of a bar).
function AppRow({ group }) {
  const [open, setOpen] = useState(false);
  const domains = group.domains || [];
  const shownDomains = open ? domains : domains.slice(0, DOMAIN_LIMIT);
  const Icon = group.browserId ? Globe : AppWindow;

  return (
    <li className="border-b border-hair py-2.5 last:border-b-0">
      <div className="grid grid-cols-[1fr_72px_56px_72px] items-center gap-2 text-xs sm:grid-cols-[1fr_88px_64px_88px]">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-txt-primary">
          <Icon size={13} className="shrink-0 text-txt-muted" />
          <span className="truncate">{group.label}</span>
        </span>
        <span className="text-right text-txt-primary">{formatHm(group.seconds)}</span>
        <span className="text-right text-txt-muted">{group.sessions}</span>
        <span className="text-right text-txt-muted">
          {group.lastSeen ? formatClock(group.lastSeen) : "--"}
        </span>
      </div>

      {domains.length > 0 && (
        <ul className="mt-1.5 space-y-1 border-l border-hair pl-4">
          {shownDomains.map((d) => (
            <li
              key={d.label}
              className="grid grid-cols-[1fr_72px_56px_72px] items-center gap-2 text-[11px] sm:grid-cols-[1fr_88px_64px_88px]"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-txt-muted">
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    d.isPrivate ? "bg-slate-400" : "bg-accentblue/70"
                  }`}
                />
                <span className="truncate">{d.label}</span>
              </span>
              <span className="text-right text-txt-primary">{formatHm(d.seconds)}</span>
              <span className="text-right text-txt-muted">{d.sessions}</span>
              <span className="text-right text-txt-muted">
                {d.lastSeen ? formatClock(d.lastSeen) : "--"}
              </span>
            </li>
          ))}
          {domains.length > DOMAIN_LIMIT && (
            <li>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[11px] font-semibold text-accentblue hover:underline"
              >
                {open ? "Show fewer sites" : `+${domains.length - DOMAIN_LIMIT} more sites`}
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export default function ApplicationsTable({ groups }) {
  const [showAll, setShowAll] = useState(false);
  const shownGroups = showAll ? groups : collapseWithRecent(groups, { limit: APP_LIMIT, recent: 3 });

  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
        <AppWindow size={13} /> Applications &amp; Websites ({groups.length})
      </h4>
      <p className="mb-2 text-[11px] text-txt-muted">Apps and websites used during this session</p>

      {groups.length === 0 ? (
        <p className="text-xs text-txt-muted">No application or website activity.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_72px_56px_72px] gap-2 border-b border-hair pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-txt-muted sm:grid-cols-[1fr_88px_64px_88px]">
            <span>Application / Website</span>
            <span className="text-right">Active Time</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Last Active</span>
          </div>
          <ul>
            {shownGroups.map((g) => (
              <AppRow key={g.key} group={g} />
            ))}
          </ul>
          {groups.length > shownGroups.length && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-accentblue hover:underline"
            >
              <ChevronDown size={13} /> See More ({groups.length - shownGroups.length} more)
            </button>
          )}
          {showAll && groups.length > APP_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-2 text-[11px] font-semibold text-accentblue hover:underline"
            >
              See less
            </button>
          )}
        </>
      )}
    </div>
  );
}
