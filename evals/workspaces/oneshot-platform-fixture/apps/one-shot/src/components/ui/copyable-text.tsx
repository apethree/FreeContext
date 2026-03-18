import { useCallback, useMemo, useState } from 'react';
import { Copy } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CopyableTextProps = {
  text: string;
  className?: string;
  mono?: boolean;
  title?: string;
};

export function CopyableText({ text, className, mono = false, title = 'Copy value' }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  const displayText = useMemo(() => {
    if (text.length > 0) {
      return text;
    }
    return '-';
  }, [text]);

  const onCopy = useCallback(() => {
    if (!text) {
      return;
    }
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => undefined);
  }, [text]);

  return (
    <div className={cn('flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1', className)}>
      <span className={cn('min-w-0 flex-1 truncate text-xs text-foreground', mono ? 'font-mono' : undefined)} title={displayText}>
        {displayText}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="h-6 w-6"
        title={copied ? 'Copied' : title}
        onClick={onCopy}
        disabled={!text}
      >
        <HugeiconsIcon icon={Copy} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
      </Button>
    </div>
  );
}
