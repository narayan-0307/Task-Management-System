import { MonitorSmartphone } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";

/**
 * Device identity column. `/monitoring/daily` only includes
 * agent.{id, agent_uuid, device_name, platform, status} for this device (see
 * monitoringController.js getMonitoringDaily) — no last-seen timestamp, agent
 * version, or IP address is returned there, so those are left out rather
 * than invented. Live status is the existing `deviceLiveStatus()` derivation.
 */
export default function DeviceInfoCard({ agent, live }) {
  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accentblue-soft text-accentblue">
          <MonitorSmartphone size={14} />
        </span>
        <div>
          <h3 className="text-xs font-semibold text-txt-primary">Device Information</h3>
          <p className="text-[11px] text-txt-muted">Current device and system details</p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-txt-muted">
          <MonitorSmartphone size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-txt-primary">
            {agent?.device_name || "Device"}
          </p>
          {agent?.platform && (
            <p className="truncate text-xs capitalize text-txt-muted">{agent.platform}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {live?.live && (
          <span className="relative flex h-2 w-2" title="live">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
        )}
        <Badge tone={live?.tone}>{live?.label}</Badge>
        {live?.hint && <span className="text-[11px] text-txt-muted">{live.hint}</span>}
      </div>
    </div>
  );
}
