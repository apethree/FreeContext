import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-background text-foreground',
        muted: 'border-border bg-muted text-muted-foreground',
        capsule:
          'border-[var(--capsule-stroke)] bg-[linear-gradient(148deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.08)_18%,rgba(255,255,255,0)_40%),var(--capsule-shell)] text-[var(--capsule-text)] shadow-[var(--capsule-shadow-recessed)]',
        'capsule-accent':
          'border-transparent bg-[linear-gradient(148deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.12)_20%,rgba(255,255,255,0)_42%),linear-gradient(330deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0)_34%),var(--capsule-badge-accent,var(--capsule-accent-soft))] text-white shadow-[0_8px_18px_rgba(70,58,46,0.09),inset_1px_2px_4px_rgba(0,0,0,0.08)]',
        'capsule-status':
          'border-transparent bg-[linear-gradient(148deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.12)_20%,rgba(255,255,255,0)_42%),linear-gradient(330deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0)_34%),var(--capsule-badge-status,var(--capsule-status-soft))] text-white shadow-[0_8px_18px_rgba(70,58,46,0.09),inset_1px_2px_4px_rgba(0,0,0,0.08)]',
        success: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        warning: 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300',
        info: 'border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
