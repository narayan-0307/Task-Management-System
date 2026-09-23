import { Menu, Home, ChevronRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import NotificationBell from "./NotificationBell.jsx";
import ThemeToggle from "../ui/ThemeToggle.jsx";

// Compact context bar. `title` acts as a breadcrumb, not a heading — pages
// carry their own <PageHeader> for the real title, so this stays muted to
// avoid rendering the same text twice at two visual weights.
export default function Topbar({ title, onMenuClick }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hair bg-page px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          onClick={onMenuClick}
          className="rounded-md p-1.5 text-txt-muted hover:bg-white/10 lg:hidden"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <nav className="flex min-w-0 items-center gap-1.5 text-txt-muted" aria-label="Breadcrumb">
          <Home size={14} className="shrink-0" />
          <ChevronRight size={13} className="shrink-0" />
          <span className="truncate text-sm font-medium text-txt-muted">{title}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-hair px-2 py-1 text-xs font-medium text-txt-primary">
          <NotificationBell />
          <span className="hidden sm:inline">Alerts</span>
        </div>

        <ThemeToggle />

        <Link
          to="/projects?create=1"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accentblue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accentblue-hover"
        >
          <Plus size={14} />
          New
        </Link>
      </div>
    </header>
  );
}
