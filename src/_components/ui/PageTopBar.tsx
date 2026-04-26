import type { ReactNode } from 'react';

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageTopBar({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <header className="flex flex-col gap-4 px-9 pb-5 pt-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[36px] leading-[1.05] text-title">{title}</h1>
        {subtitle && (
          <p className="mt-2 max-w-[540px] text-sm text-common">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
