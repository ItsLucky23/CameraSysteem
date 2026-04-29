import { ReactNode, useEffect, useRef, useState } from 'react';

import MaterialIcon from 'src/_components/ui/MaterialIcon';

interface Props {
  title: string;
  body: ReactNode;
  ariaLabel?: string;
}

// Tiny informational popover. An (i) icon button toggles a small panel below
// the icon (or above when there's not enough room downward). Click-outside
// and Escape close it. Used inside form modals to explain what each field
// controls without bloating the modal with always-visible text.
export default function InfoPopover({ title, body, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    // Decide which way to open based on remaining viewport space below the
    // trigger. Re-runs every time the popover opens so window resizes don't
    // matter — nothing renders before this effect on the open transition.
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 220);
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={`relative inline-flex`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel ?? title}
        aria-expanded={open}
        onClick={() => { setOpen((prev) => !prev); }}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-container2-border text-muted transition-colors hover:border-container1-border hover:text-title ${open ? 'border-container1-border text-title' : ''}`}
      >
        <MaterialIcon name="info" size={14} />
      </button>
      {open && (
        <div
          role="tooltip"
          className={`absolute right-0 z-50 w-72 rounded-xl border border-container2-border bg-container2 p-3 shadow-lg ${openUpward ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <div className="mb-1.5 text-sm font-semibold text-title">{title}</div>
          <div className="space-y-2 text-xs leading-relaxed text-common">
            {body}
          </div>
        </div>
      )}
    </div>
  );
}
