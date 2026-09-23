import { useState, useRef, useEffect } from "react";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import Avatar from "../ui/Avatar.jsx";

export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (compact) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
          aria-label="Account menu"
        >
          <Avatar firstName={user?.first_name} lastName={user?.last_name} avatarUrl={user?.avatar_url} size="sm" />
        </button>

        {open && (
          <div className="absolute bottom-0 left-full ml-2 w-44 rounded-lg border border-hair bg-surface-2 py-1 shadow-lg">
            <div className="border-b border-hair px-3 py-2">
              <span className="block truncate text-sm font-medium text-txt-primary">
                {user?.first_name} {user?.last_name}
              </span>
              <span className="block text-xs capitalize text-txt-muted">
                {user?.role}
              </span>
            </div>
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-txt-muted hover:bg-white/5 hover:text-txt-primary"
            >
              <LogOut size={16} />
              Log out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <Avatar firstName={user?.first_name} lastName={user?.last_name} avatarUrl={user?.avatar_url} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-txt-primary">
            {user?.first_name} {user?.last_name}
          </span>
          <span className="block truncate text-xs capitalize text-txt-muted">{user?.role}</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-txt-muted" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-full min-w-[180px] rounded-lg border border-hair bg-surface-2 py-1 shadow-lg">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-txt-muted hover:bg-white/5 hover:text-txt-primary"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
