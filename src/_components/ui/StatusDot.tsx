type Status = 'online' | 'offline' | 'idle' | 'rec';

interface Props {
  status?: Status;
  pulse?: boolean;
  size?: number;
}

const colorFor = (status: Status): string => {
  switch (status) {
    case 'online': {
      return 'var(--color-correct)';
    }
    case 'offline': {
      return 'var(--color-wrong)';
    }
    case 'idle': {
      return 'var(--color-warning)';
    }
    case 'rec': {
      return 'var(--color-wrong)';
    }
  }
};

export default function StatusDot({ status = 'online', pulse = false, size = 8 }: Props) {
  const color = colorFor(status);
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: pulse ? `0 0 0 4px ${color}22` : undefined,
      }}
    />
  );
}
