import { useState } from "react";
import { LayoutGrid, AppWindow, ScrollText, MessageSquare, Camera, Monitor } from "lucide-react";

/**
 * Section navigation for the one-page employee detail view. Everything still
 * lives on a single page (no new routes) — each tab just smooth-scrolls to
 * the section that already renders that data, or (Screenshots / Live Screen)
 * jumps to the existing Remote Monitoring section where those real handlers
 * live. No functionality is invented here.
 */
const TABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "applications", label: "Applications", icon: AppWindow },
  { key: "activity", label: "Activity Logs", icon: ScrollText },
  { key: "search", label: "Search & Prompts", icon: MessageSquare },
  { key: "remote", label: "Screenshots", icon: Camera },
  { key: "remote", label: "Live Screen", icon: Monitor },
];

export default function MonitoringTabs({ sectionRefs }) {
  const [active, setActive] = useState("overview");

  function goTo(key) {
    setActive(key);
    if (key === "overview") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    sectionRefs?.[key]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-hair">
      {TABS.map((tab, i) => {
        const isActive = active === tab.key;
        return (
          <button
            key={`${tab.key}-${tab.label}`}
            type="button"
            onClick={() => goTo(tab.key)}
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors ${
              isActive ? "text-txt-primary" : "text-txt-muted hover:text-txt-primary"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accentblue" />
            )}
          </button>
        );
      })}
    </div>
  );
}
