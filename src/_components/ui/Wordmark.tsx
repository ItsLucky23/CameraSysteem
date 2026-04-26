import BrandMark from './BrandMark';

interface Props {
  small?: boolean;
}

export default function Wordmark({ small = false }: Props) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={small ? 22 : 26} />
      <div className="flex flex-col leading-none">
        <span className="font-display text-title" style={{ fontSize: small ? 18 : 22 }}>Aperture</span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted">Camera Control</span>
      </div>
    </div>
  );
}
