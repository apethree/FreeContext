import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type MessageRole = 'user' | 'assistant';

export type MessageProps = ComponentProps<'div'> & {
  role: MessageRole;
};

export function Message({ className, role, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        'max-w-[88%] rounded-md px-3 py-2 text-sm',
        role === 'user'
          ? 'ml-auto bg-secondary text-secondary-foreground'
          : 'mr-auto border border-border/60 bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = ComponentProps<'div'>;

export function MessageContent({ className, ...props }: MessageContentProps) {
  return <div className={cn('space-y-1', className)} {...props} />;
}
