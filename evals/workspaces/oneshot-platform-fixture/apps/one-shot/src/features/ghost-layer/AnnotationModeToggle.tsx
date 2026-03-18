import { cn } from '@/lib/utils';
import type { PointerEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { OneShotLogo } from '@/features/app/OneShotLogo';

type AnnotationModeToggleProps = {
  isInteracting: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onSetInteracting: (next: boolean) => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
};

export function AnnotationModeToggle({
  isInteracting,
  isCollapsed,
  onToggleCollapsed,
  onSetInteracting,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: AnnotationModeToggleProps) {
  const showHelper = !isCollapsed && !isInteracting;

  return (
    <div
      className={cn(
        'relative flex select-none',
        showHelper ? 'flex-col items-stretch gap-1.5' : 'items-center gap-1',
        'rounded-[18px] px-2 py-1.5 cursor-grab active:cursor-grabbing',
        isInteracting ? 'toolbar-glass-interact' : 'toolbar-glass',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label="Annotation mode toggle"
      role="group"
    >
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleCollapsed}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded-xl p-1.5 [color:var(--dock-fg)] transition-colors hover:bg-[var(--dock-surface-active)]"
              aria-label={isCollapsed ? 'Expand mode toggle' : 'Collapse mode toggle'}
            >
              <OneShotLogo className="h-5 w-5 text-[var(--dock-fg)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-[#0a1628]/95 text-white border-blue-400/20 text-xs">
            Shortcut: Ctrl/Cmd + I
          </TooltipContent>
        </Tooltip>

        {!isCollapsed && (
          <>
            <span className="h-5 w-px bg-[var(--dock-divider)]" />
            <button
              type="button"
              onClick={() => onSetInteracting(false)}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'rounded-xl px-3 py-1 text-[12px] font-semibold transition-colors',
                !isInteracting
                  ? 'bg-[var(--dock-surface-active)] [color:var(--dock-fg)]'
                  : '[color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)]',
              )}
              aria-pressed={!isInteracting}
            >
              Annotate
            </button>
            <button
              type="button"
              onClick={() => onSetInteracting(true)}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'rounded-xl px-3 py-1 text-[12px] font-semibold transition-colors',
                isInteracting
                  ? 'bg-[var(--dock-surface-active)] [color:var(--dock-fg)]'
                  : '[color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)]',
              )}
              aria-pressed={isInteracting}
            >
              Browse
            </button>
          </>
        )}
      </div>

      {showHelper && (
        <div className="max-w-[290px] px-1.5 pb-0.5">
          <p className="pt-0.5 text-[10px] font-normal leading-snug [color:var(--dock-fg-muted)]">
            {isInteracting ? 'Annotatoin disabled' : 'Page locked. Use browse to interact'}
          </p>
        </div>
      )}
    </div>
  );
}
