import { cn } from '@/lib/utils';

type BadgeTone = 'active' | 'inactive' | 'warning' | 'error';

export function TransportBadge(props: {
  system: string;
  stationCode: string;
  label?: string;
  tone?: BadgeTone;
  className?: string;
}) {
  const tone = props.tone ?? 'inactive';
  const palette = {
    active: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    inactive: 'border-slate-300 bg-slate-50 text-slate-700',
    warning: 'border-amber-300 bg-amber-50 text-amber-800',
    error: 'border-red-300 bg-red-50 text-red-800',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        palette,
        props.className,
      )}
    >
      <span className="rounded-sm bg-black/85 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
        {props.system}
      </span>
      <span className="rounded-sm border border-current/30 bg-white/80 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
        {props.stationCode}
      </span>
      {props.label ? <span className="max-w-24 truncate text-[10px]">{props.label}</span> : null}
    </span>
  );
}
