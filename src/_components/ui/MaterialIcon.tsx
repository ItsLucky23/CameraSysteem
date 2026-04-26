interface Props {
  name: string;
  size?: number;
  className?: string;
  filled?: boolean;
  onClick?: () => void;
}

export default function MaterialIcon({ name, size = 18, className, filled = false, onClick }: Props) {
  return (
    <span
      className={`material-symbols-outlined select-none ${className ?? ''}`}
      style={{
        fontSize: `${String(size)}px`,
        lineHeight: 1,
        fontVariationSettings: filled
          ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24"
          : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
      }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          onClick();
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {name}
    </span>
  );
}
