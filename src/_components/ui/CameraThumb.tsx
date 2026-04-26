type Status = 'online' | 'offline' | 'idle';

interface Props {
  src?: string | null;
  status?: Status;
  label?: string;
  slug?: string;
  height?: number | string;
  rounded?: number;
  showLiveBadge?: boolean;
  liveLabel?: string;
  offlineLabel?: string;
  rec?: boolean;
}

export default function CameraThumb({
  src,
  status = 'online',
  label,
  slug,
  height = 120,
  rounded = 12,
  showLiveBadge = true,
  liveLabel = 'Live',
  offlineLabel = 'Offline',
  rec = false,
}: Props) {
  const offline = status === 'offline';
  const heightStyle = typeof height === 'number' ? `${String(height)}px` : height;

  return (
    <div
      className="relative overflow-hidden bg-container2"
      style={{ height: heightStyle, borderRadius: rounded }}
    >
      {src ? (
        <img
          alt=""
          src={src}
          className="h-full w-full object-cover"
          style={{
            filter: offline ? 'grayscale(1) opacity(0.55)' : 'saturate(0.9) contrast(1.02)',
          }}
        />
      ) : (
        <div className="cam-placeholder h-full w-full" />
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%)',
        }}
      />
      {showLiveBadge && !offline && (
        <div className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" style={{ boxShadow: '0 0 0 4px rgba(34,197,94,0.18)' }} />
          {liveLabel}
        </div>
      )}
      {offline && (
        <div className="absolute left-2.5 top-2.5 rounded bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          {offlineLabel}
        </div>
      )}
      {rec && !offline && (
        <div className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded bg-wrong/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          REC
        </div>
      )}
      {slug && !rec && (
        <div className="absolute right-2.5 top-2.5 rounded bg-black/45 px-2 py-1 font-mono text-[10px] font-semibold text-white">
          {slug}
        </div>
      )}
      {label && (
        <div className="absolute bottom-2.5 left-3 text-sm font-semibold tracking-tight text-white" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.45)' }}>
          {label}
        </div>
      )}
    </div>
  );
}
