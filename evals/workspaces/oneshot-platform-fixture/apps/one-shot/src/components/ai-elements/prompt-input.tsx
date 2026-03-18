import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type PromptInputProps = ComponentProps<'div'>;

export function PromptInput({ className, ...props }: PromptInputProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border/75 bg-background/90 px-2 py-2 shadow-sm backdrop-blur-md transition-colors focus-within:border-primary/45',
        className,
      )}
      {...props}
    />
  );
}

export type PromptInputToolbarProps = ComponentProps<'div'>;

export function PromptInputToolbar({ className, ...props }: PromptInputToolbarProps) {
  return <div className={cn('mt-2 flex items-center justify-between', className)} {...props} />;
}
