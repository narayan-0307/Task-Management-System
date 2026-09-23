export default function StatCard({ label, value, icon: Icon, hint, className = "" }) {
  return (
    <div className={`rounded-xl border border-hair bg-surface-1 p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-txt-muted">
          {label}
        </span>
        {Icon && <Icon size={16} className="text-txt-muted" />}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold text-txt-primary">{value}</p>
      {hint && <p className="mt-1 text-xs text-txt-muted">{hint}</p>}
    </div>
  );
}
