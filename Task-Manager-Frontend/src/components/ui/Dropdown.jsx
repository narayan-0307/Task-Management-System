import { useEffect, useRef, useState } from "react";

/**
 * Lightweight menu trigger + panel. Consumers supply `trigger` (a render
 * prop receiving { open, toggle }) and `children` (the panel content),
 * so existing per-page menu markup (icons, item styling) drops in as-is.
 */
export default function Dropdown({ trigger, children, align = "right", className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`absolute z-40 mt-1.5 min-w-[160px] rounded-lg border border-hair bg-surface-2 py-1 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
