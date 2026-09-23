import { Monitor, Camera, ArrowRight } from "lucide-react";

/**
 * Presentation only. `onOpenLiveScreen` / `onOpenScreenshot` are the same
 * `setViewerOpen(true)` / `setScreenshotOpen(true)` handlers DeviceSection
 * already owned — the LiveScreenViewer / ScreenshotCapture modals they open
 * are untouched. `live` is the existing deviceLiveStatus() result gating
 * whether the device is reachable right now.
 */
function ActionCard({ icon: Icon, title, description, disabledHint, canAct, onClick }) {
  return (
    <button
      type="button"
      disabled={!canAct}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
        canAct
          ? "border-hair bg-surface-1 hover:border-accentblue/40 hover:bg-surface-2"
          : "cursor-not-allowed border-hair bg-surface-1/60"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          canAct ? "bg-accentblue-soft text-accentblue" : "bg-surface-2 text-txt-muted"
        }`}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-txt-primary">{title}</span>
        <span className="block text-xs text-txt-muted">
          {canAct ? description : disabledHint}
        </span>
      </span>
      {canAct && <ArrowRight size={16} className="shrink-0 text-txt-muted" />}
    </button>
  );
}

export default function RemoteMonitoringSection({ live, onOpenLiveScreen, onOpenScreenshot }) {
  const canAct = Boolean(live?.live);

  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-5">
      <h3 className="text-sm font-semibold text-txt-primary">Remote Monitoring</h3>
      <p className="mt-0.5 text-xs text-txt-muted">
        View live screen or capture a screenshot of the device.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ActionCard
          icon={Monitor}
          title="Live Screen"
          description="View current screen"
          disabledHint={`Unavailable · ${live?.label || "Offline"}`}
          canAct={canAct}
          onClick={onOpenLiveScreen}
        />
        <ActionCard
          icon={Camera}
          title="Screenshot"
          description="Capture current screen"
          disabledHint={`Unavailable · ${live?.label || "Offline"}`}
          canAct={canAct}
          onClick={onOpenScreenshot}
        />
      </div>
    </div>
  );
}
