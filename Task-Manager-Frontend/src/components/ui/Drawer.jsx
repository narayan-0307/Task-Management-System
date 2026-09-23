import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Reusable right-side drawer: fixed header + scrollable body + fixed footer,
 * slide-in animation, subtle overlay, Esc / overlay / X to close.
 * Presentation-only wrapper — consumers keep their own form + submit logic.
 */
export default function Drawer({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = "sm:w-[480px]",
}) {
  const [shouldRender, setShouldRender] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      // Double rAF instead of a fixed setTimeout: the first frame lets the
      // browser commit+paint the just-mounted (closed-position) children,
      // the second then flips the transition classes — so the slide-in
      // reliably starts from a painted baseline instead of racing an
      // arbitrary delay against however long that initial paint takes.
      let frameId = requestAnimationFrame(() => {
        frameId = requestAnimationFrame(() => {
          setVisible(true);
        });
      });
      return () => cancelAnimationFrame(frameId);
    }
    setVisible(false);
    const t = setTimeout(() => setShouldRender(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!shouldRender) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed right-0 top-0 flex h-screen w-full flex-col bg-surface-1 shadow-xl transition-transform duration-300 ease-in-out ${width} ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Fixed header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-hair px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-txt-primary">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs text-txt-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Fixed footer */}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hair px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
