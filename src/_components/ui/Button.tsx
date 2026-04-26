import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'ghost' | 'danger';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
}

const styleFor = (variant: Variant): string => {
  switch (variant) {
    case 'primary': {
      return 'bg-primary border-primary-border text-title-primary hover:bg-primary-hover';
    }
    case 'ghost': {
      return 'bg-transparent border-transparent text-title hover:bg-container2';
    }
    case 'danger': {
      return 'bg-wrong border-wrong text-white hover:bg-wrong-hover';
    }
    case 'default': {
      return 'bg-container1 border-container1-border text-title hover:bg-container1-hover';
    }
  }
};

export default function Button({ variant = 'default', children, fullWidth = false, className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[13px] font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${styleFor(variant)} ${fullWidth ? 'w-full justify-center' : ''} ${className ?? ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
