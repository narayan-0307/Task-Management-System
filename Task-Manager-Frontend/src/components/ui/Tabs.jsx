export default function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div className={`flex items-center gap-1 border-b border-hair ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? "text-txt-primary" : "text-txt-muted hover:text-txt-primary"
            }`}
          >
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
