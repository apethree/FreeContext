import { ArrowUpRight } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type UpgradeButtonProps = {
  onClick?: () => void;
  className?: string;
  size?: React.ComponentProps<typeof Button>['size'];
  children?: React.ReactNode;
};

export function UpgradeButton({
  onClick,
  className,
  size = 'default',
  children = 'Upgrade Now',
}: UpgradeButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={onClick}
      className={cn(
        'relative isolate overflow-hidden rounded-full border border-white/18 py-4 text-white',
        'bg-blue-600 hover:bg-blue-500 active:translate-y-px active:bg-blue-700',
        'shadow-[0_18px_44px_-26px_rgba(37,99,235,0.95)]',
        'before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_26%_18%,rgba(255,255,255,0.35),transparent_56%)] before:opacity-100',
        'after:absolute after:inset-0 after:bg-[linear-gradient(to_bottom,rgba(255,255,255,0.14),transparent_44%)] after:opacity-100',
        'focus-visible:border-blue-200/35 focus-visible:ring-blue-300/35',
        className,
      )}
    >
      <span className="relative z-10 inline-flex items-center gap-2.5">
        <span className="inline-flex items-center rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white ring-1 ring-white/22 backdrop-blur-md">
          Pro
        </span>
        <span className="text-[13px] font-semibold tracking-tight">{children}</span>
        <span className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/14 ring-1 ring-white/22 backdrop-blur-md">
          <HugeiconsIcon icon={ArrowUpRight} className="h-4 w-4" />
        </span>
      </span>
    </Button>
  );
}
