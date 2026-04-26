interface Props {
  on: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function Toggle({ on, onChange, disabled = false, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onChange) {
          onChange(!on);
        }
      }}
      className={`relative inline-block h-5 w-9 rounded-full transition-colors duration-150 ${on ? 'bg-primary' : 'bg-container2-border'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150"
        style={{ left: on ? 18 : 2 }}
      />
    </button>
  );
}
