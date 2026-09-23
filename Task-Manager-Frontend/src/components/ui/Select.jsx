import { ChevronDown } from "lucide-react";

export default function Select({ className = "", children, ...props }) {
  return (
    <div className="relative">
      <select
        className={`w-full appearance-none rounded-lg border border-hair bg-surface-1 px-3 py-2 pr-8 text-sm text-txt-primary focus:border-accentblue focus:outline-none focus:ring-1 focus:ring-accentblue disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-txt-muted ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-txt-muted"
      />
    </div>
  );
}
