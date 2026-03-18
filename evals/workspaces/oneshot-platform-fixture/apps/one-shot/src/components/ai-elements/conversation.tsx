import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type ConversationProps = ComponentProps<'div'>;

export function Conversation({ className, ...props }: ConversationProps) {
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)} {...props} />;
}

export type ConversationViewportProps = ComponentProps<'div'>;

export function ConversationViewport({ className, ...props }: ConversationViewportProps) {
  return (
    <div
      className={cn('h-full space-y-2 overflow-y-auto px-3 pb-3 pt-4', className)}
      {...props}
    />
  );
}

export type ConversationFadeProps = ComponentProps<'div'>;

export function ConversationFade({ className, ...props }: ConversationFadeProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background via-background/80 to-transparent',
        className,
      )}
      {...props}
    />
  );
}
