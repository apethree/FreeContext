import { Badge } from "@/components/ui/badge";
import { MODE_CONFIG } from "@/features/app/modeConfig";
import type { AppMode } from "@/features/app/types";

type DomainAgentCardProps = {
  mode: AppMode;
  onClick: () => void;
};

export function DomainAgentCard({ mode, onClick }: DomainAgentCardProps) {
  const config = MODE_CONFIG[mode];
  const isActive = config.navItems.length > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-left transition-colors hover:bg-accent/50"
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: `hsl(${config.color})` }}
      />
      <span className="text-xs font-medium text-foreground">
        {config.label}
      </span>
      <Badge
        variant={isActive ? "default" : "muted"}
        className="ml-auto text-[10px]"
      >
        {isActive ? "active" : "idle"}
      </Badge>
    </button>
  );
}
