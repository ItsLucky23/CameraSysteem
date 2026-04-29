import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import MaterialIcon from 'src/_components/ui/MaterialIcon';

interface Props {
  title: string;
  body: ReactNode;
  ariaLabel?: string;
}

interface PanelCoords {
  top: number;
  left: number;
  openUpward: boolean;
}

const PANEL_WIDTH = 288;
const PANEL_GAP = 8;

// Tiny informational popover. An (i) icon button toggles a small panel near
// the icon. The panel is rendered into document.body via a portal so no
// ancestor with overflow:hidden, transform, filter, or backdrop-filter can
// clip it (the modal backdrop in admin/page.tsx uses backdrop-blur which
// would otherwise turn position:fixed into a containing-block trap).
export default function InfoPopover({ title, body, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PanelCoords | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const computeCoords = (): PanelCoords | null => {
    const button = buttonRef.current;
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 220;
    const top = openUpward ? rect.top - PANEL_GAP : rect.bottom + PANEL_GAP;
    // Anchor the right edge of the panel to the right edge of the trigger so
    // labels next to the (i) icon don't get covered.
    let left = rect.right - PANEL_WIDTH;
    if (left < 8) left = 8;
    if (left + PANEL_WIDTH > window.innerWidth - 8) {
      left = window.innerWidth - PANEL_WIDTH - 8;
    }
    return { top, left, openUpward };
  };

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }

    setCoords(computeCoords());

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleReposition = () => {
      setCoords(computeCoords());
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  return (
    <>
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
      {open && coords && createPortal(
        <div
          ref={panelRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.openUpward ? undefined : coords.top,
            bottom: coords.openUpward ? window.innerHeight - coords.top : undefined,
            left: coords.left,
            width: PANEL_WIDTH,
          }}
          className="z-[1000] rounded-xl border border-container2-border bg-container2 p-3 shadow-lg"
        >
          <div className="mb-1.5 text-sm font-semibold text-title">{title}</div>
          <div className="space-y-2 text-xs leading-relaxed text-common">
            {body}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
