import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: string;
  trailingLabel?: ReactNode;
  onTrailingClick?: () => void;
  containerClassName?: string;
}

export default function Field({ label, trailingLabel, onTrailingClick, containerClassName, className, ...rest }: Props) {
  return (
    <div className={containerClassName}>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-[12.5px] font-semibold text-title">{label}</label>
        {trailingLabel && (
          <button
            type="button"
            onClick={onTrailingClick}
            className="cursor-pointer border-none bg-transparent p-0 text-xs text-primary"
          >
            {trailingLabel}
          </button>
        )}
      </div>
      <input
        className={`h-[42px] w-full rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary ${className ?? ''}`}
        {...rest}
      />
    </div>
  );
}
