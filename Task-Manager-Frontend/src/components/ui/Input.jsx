export default function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-lg border border-hair bg-surface-1 px-3 py-2 text-sm text-txt-primary placeholder:text-txt-muted focus:border-accentblue focus:outline-none focus:ring-1 focus:ring-accentblue disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-txt-muted ${className}`}
      {...props}
    />
  );
}
