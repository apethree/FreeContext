import {
  AiChat01Icon,
  Briefcase01Icon,
  CoinsDollarIcon,
  GroupIcon,
  HealthIcon,
  Mail01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { ColorSwatchSelector } from "@/components/ui/color-swatch-selector";
import { OneShotLogo } from "@/features/app/OneShotLogo";
import { MODE_CONFIG } from "@/features/app/modeConfig";
import type { AppMode, SidebarModeSelection } from "@/features/app/types";
import type { CSSProperties } from "react";

type ModeSwitcherProps = {
  selection: SidebarModeSelection;
  onSelect: (selection: SidebarModeSelection) => void;
  onOpenModeChat: (selection: SidebarModeSelection) => void;
};

const MODE_ICON_ASSET: Record<AppMode, unknown> = {
  work: Briefcase01Icon,
  finance: CoinsDollarIcon,
  social: GroupIcon,
  health: HealthIcon,
  chats: AiChat01Icon,
  mail: Mail01Icon,
};

function modeIconAsset(mode: AppMode): unknown {
  return MODE_ICON_ASSET[mode] ?? Briefcase01Icon;
}

export function modeIcon(mode: AppMode) {
  const icon = modeIconAsset(mode);
  return function ModeIconGlyph({ className }: { className?: string }) {
    return <HugeiconsIcon icon={icon as never} className={className} />;
  };
}

type SwatchSpec = {
  selection: SidebarModeSelection;
  color: string;
  label: string;
};

const SWATCH_SPECS: SwatchSpec[] = [
  { selection: "oneshot", color: "#000000", label: "One Shot" },
  { selection: "work", color: "#3b82f6", label: "Work" },
  { selection: "finance", color: "#10b981", label: "Finance" },
  { selection: "social", color: "#f59e0b", label: "Social" },
  { selection: "health", color: "#ef4444", label: "Health" },
  { selection: "chats", color: "#8b5cf6", label: "Chats" },
  { selection: "mail", color: "#06b6d4", label: "Mail" },
];

const SWATCH_BY_SELECTION = SWATCH_SPECS.reduce<Record<SidebarModeSelection, SwatchSpec>>((acc, item) => {
  acc[item.selection] = item;
  return acc;
}, {} as Record<SidebarModeSelection, SwatchSpec>);

const SELECTION_BY_SWATCH = SWATCH_SPECS.reduce<Record<string, SidebarModeSelection>>((acc, item) => {
  acc[item.color] = item.selection;
  return acc;
}, {});

function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace("#", "");
  const safeHex = normalized.length === 3
    ? normalized.split("").map((ch) => `${ch}${ch}`).join("")
    : normalized;
  const value = Number.parseInt(safeHex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r} ${g} ${b}`;
}

function selectionLabel(selection: SidebarModeSelection): string {
  if (selection === "oneshot") return "One Shot";
  return MODE_CONFIG[selection].label;
}

function triggerSelectionHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }

  const shell = (window as unknown as { appShell?: { triggerHaptic?: (kind: string) => void } }).appShell;
  shell?.triggerHaptic?.("selection");
}

export function ModeSwitcher({ selection, onSelect, onOpenModeChat }: ModeSwitcherProps) {
  const activeSwatch = SWATCH_BY_SELECTION[selection]?.color ?? SWATCH_SPECS[0].color;
  const activeSwatchRgb = hexToRgbChannels(activeSwatch);
  const activeLabel = selectionLabel(selection);
  const Icon = selection === "oneshot" ? null : modeIcon(selection);
  const modeGlassStyle = {
    ["--mode-switcher-accent-rgb" as string]: activeSwatchRgb,
  } as CSSProperties;

  return (
    <div className="mode-switcher-glass" style={modeGlassStyle}>
      <div className="mode-switcher-active-row">
        <div className="mode-switcher-active-main">
          <span className="mode-switcher-icon-wrap">
            {selection === "oneshot" ? (
              <OneShotLogo className="h-5 w-5 text-sidebar-foreground" />
            ) : Icon ? (
              <Icon className="h-5 w-5" />
            ) : null}
          </span>
          <span className="mode-switcher-label">{activeLabel}</span>
        </div>
        <button
          type="button"
          className="mode-switcher-chat-btn"
          aria-label={`Open ${activeLabel} chat`}
          title={`Open ${activeLabel} chat`}
          onClick={() => onOpenModeChat(selection)}
        >
          <HugeiconsIcon icon={Message01Icon} className="h-4 w-4" />
        </button>
      </div>

      <ColorSwatchSelector.Root
        value={activeSwatch}
        className="mode-switcher-swatch-root"
        onValueChange={(next) => {
          const nextSelection = SELECTION_BY_SWATCH[next];
          if (!nextSelection) return;
          if (nextSelection === selection) return;
          triggerSelectionHaptic();
          onSelect(nextSelection);
        }}
      >
        <ColorSwatchSelector.Content className="mode-switcher-swatch-content">
          {SWATCH_SPECS.map((item) => (
            <ColorSwatchSelector.Item
              key={item.selection}
              value={item.color}
              className="mode-switcher-swatch-item"
            />
          ))}
        </ColorSwatchSelector.Content>
      </ColorSwatchSelector.Root>
    </div>
  );
}
