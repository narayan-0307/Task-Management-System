import { User } from "lucide-react";
import Avatar from "../../../components/ui/Avatar.jsx";

/**
 * Employee identity column. The `/monitoring/daily` response's `user` object
 * only carries id/first_name/last_name/email (see monitoringController.js
 * getMonitoringDaily) — there is no role/joined-date/organization field to
 * show here, so this intentionally shows only what the API returns rather
 * than inventing placeholder fields.
 */
export default function EmployeeInfoCard({ user, name }) {
  return (
    <div className="rounded-xl border border-hair bg-surface-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accentblue-soft text-accentblue">
          <User size={14} />
        </span>
        <div>
          <h3 className="text-xs font-semibold text-txt-primary">Employee Information</h3>
          <p className="text-[11px] text-txt-muted">Basic details and account status</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Avatar firstName={user?.first_name} lastName={user?.last_name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-txt-primary">{name}</p>
          <p className="truncate text-xs text-txt-muted">{user?.email}</p>
        </div>
      </div>
    </div>
  );
}
