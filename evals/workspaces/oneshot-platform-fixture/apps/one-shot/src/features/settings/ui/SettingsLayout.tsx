import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

export function InsetGroup({ children }: { children: ReactNode }) {
  return (
    <Card className="mx-0 overflow-hidden border border-border/80 bg-card py-0 shadow-none">
      <div className="divide-y divide-transparent">{children}</div>
    </Card>
  );
}

export function InsetRow({
  title,
  description,
  control,
  icon,
  last = false,
}: {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  icon?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative grid grid-cols-1 gap-3 bg-accent/40 px-4 py-3 md:grid-cols-[1fr_18rem] md:items-center">
      {!last ? (
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 border-b border-border/70" />
      ) : null}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-responsive-xs font-medium text-foreground">
          {icon}
          <span>{title}</span>
        </div>
        {description ? <div className="mt-1 text-responsive-xs text-muted-foreground">{description}</div> : null}
      </div>
      <div className="min-w-0 md:justify-self-end">{control}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-responsive-xs font-semibold tracking-tight text-foreground">{children}</h2>;
}
