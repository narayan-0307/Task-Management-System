import { useState } from "react";

export default function Tooltip({ label, children, side = "top" }) {
  const [visible, setVisible] = useState(false);

  const sideClass =
    side === "bottom"
      ? "top-full mt-1.5"
      : side === "left"
        ? "right-full mr-1.5 top-1/2 -translate-y-1/2"
        : side === "right"
          ? "left-full ml-1.5 top-1/2 -translate-y-1/2"
          : "bottom-full mb-1.5";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && label && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-hair bg-surface-3 px-2 py-1 text-[11px] font-medium text-txt-primary shadow-lg ${sideClass} ${
            side === "left" || side === "right" ? "" : "left-1/2 -translate-x-1/2"
          }`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
