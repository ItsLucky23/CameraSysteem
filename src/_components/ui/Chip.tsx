import type { ReactNode } from 'react';

type Variant = 'default' | 'correct' | 'warning' | 'wrong' | 'primary' | 'accent';

interface Props {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

const styleFor = (variant: Variant): string => {
  switch (variant) {
    case 'correct': {
      return 'bg-correct-soft text-correct border-transparent';
    }
    case 'warning': {
      return 'bg-warning-soft text-warning border-transparent';
    }
    case 'wrong': {
      return 'bg-wrong-soft text-wrong border-transparent';
    }
    case 'primary': {
      return 'bg-primary-soft text-primary border-transparent';
    }
    case 'accent': {
      return 'bg-accent-soft text-accent border-transparent';
    }
    case 'default': {
      return 'bg-container2 text-common border-container2-border';
    }
  }
};

export default function Chip({ variant = 'default', children, className }: Props) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${styleFor(variant)} ${className ?? ''}`}>
      {children}
    </span>
  );
}
