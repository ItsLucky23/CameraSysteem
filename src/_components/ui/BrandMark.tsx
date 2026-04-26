interface Props {
  size?: number;
  color?: string;
}

export default function BrandMark({ size = 28, color = 'var(--color-primary)' }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="1" y="1" width="26" height="26" rx="8" stroke={color} strokeWidth="1.5" />
      <circle cx="14" cy="14" r="6.5" stroke={color} strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2.5" fill={color} />
      <circle cx="20.5" cy="7.5" r="1.25" fill={color} />
    </svg>
  );
}
