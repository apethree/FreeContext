import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ComputerTerminal01Icon,
  FolderOpen,
  LayoutAlignLeftIcon,
  AiSearch02Icon,
  PanelLeftIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { OPEN_TARGETS } from "@/features/app/constants";
import type { AppMode, OpenTarget } from "@/features/app/types";
import type { ShellSection } from "@/features/app/shellRoutes";

type AppTopBarRowProps = {
  pageTitle: string;
  activeMode: AppMode;
  section: ShellSection;
  collapsed: boolean;
  isWebRuntime: boolean;
  selectedEditor: OpenTarget;
  onSelectEditor: (target: OpenTarget) => void;
  onOpenTarget: (target: OpenTarget) => Promise<void>;
  onOpenTerminal: () => void;
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
};

const MAC_TRAFFIC_LIGHT_LEFT_PX = 16;
const MAC_TRAFFIC_LIGHT_TOP_PX = 19;
const MAC_TRAFFIC_LIGHT_SIZE_PX = 12;
const MAC_TRAFFIC_LIGHT_GAP_PX = 8;
const MAC_TRAFFIC_LIGHT_CENTER_Y_PX =
  MAC_TRAFFIC_LIGHT_TOP_PX + MAC_TRAFFIC_LIGHT_SIZE_PX / 2;
const TOPBAR_ROW_HEIGHT_PX = 32;
const TOPBAR_ROW_TOP_PX =
  MAC_TRAFFIC_LIGHT_CENTER_Y_PX - TOPBAR_ROW_HEIGHT_PX / 2;
const TOPBAR_DRAG_HEIGHT_PX = TOPBAR_ROW_TOP_PX + TOPBAR_ROW_HEIGHT_PX;
const TOPBAR_TOGGLE_BUTTON_SIZE_PX = 24;
const TOPBAR_TOGGLE_LEFT_GAP_PX = 12;
const TOPBAR_TOGGLE_TOP_IN_ROW_PX = 2.5; // Center the toggle button vertically within the top bar row
(TOPBAR_ROW_HEIGHT_PX - TOPBAR_TOGGLE_BUTTON_SIZE_PX) / 2;
const TOPBAR_TOGGLE_LEFT_PX =
  MAC_TRAFFIC_LIGHT_LEFT_PX +
  MAC_TRAFFIC_LIGHT_SIZE_PX * 3 +
  MAC_TRAFFIC_LIGHT_GAP_PX * 2 +
  TOPBAR_TOGGLE_LEFT_GAP_PX;
const TOPBAR_TOGGLE_ICON_SIZE_PX = 16;
const INSTANCE_LABEL =
  String(import.meta.env.VITE_INSTANCE_LABEL || "default").trim() || "default";
const INSTANCE_COLOR_RAW = String(
  import.meta.env.VITE_INSTANCE_COLOR || "",
).trim();
const INSTANCE_COLOR = /^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/.test(
  INSTANCE_COLOR_RAW,
)
  ? INSTANCE_COLOR_RAW
  : "#64748b";

export function AppTopBarRow({
  pageTitle,
  activeMode,
  section,
  collapsed,
  isWebRuntime,
  selectedEditor,
  onSelectEditor,
  onOpenTarget,
  onOpenTerminal,
  onOpenSearch,
  onToggleSidebar,
}: AppTopBarRowProps) {
  const sidebarIcon = collapsed ? PanelLeftIcon : LayoutAlignLeftIcon;
  const sidebarIconTestId = collapsed
    ? "sidebar-icon-closed"
    : "sidebar-icon-open";
  const currentEditor = OPEN_TARGETS.find(
    (target) => target.id === selectedEditor,
  );
  const showWorkControls =
    activeMode === "work" && section !== "global-assistant" && !isWebRuntime;

  return (
    <header
      data-testid="app-topbar-row"
      className="window-drag absolute inset-x-0 top-0 z-50"
      style={{
        height: `${TOPBAR_DRAG_HEIGHT_PX}px`,
        borderTop: `2px solid ${INSTANCE_COLOR}`,
      }}
    >
      <div
        className="absolute inset-x-0 h-8"
        style={{ top: `${TOPBAR_ROW_TOP_PX}px` }}
      >
        <div
          className="window-no-drag absolute"
          style={{
            left: `${TOPBAR_TOGGLE_LEFT_PX}px`,
            top: `${TOPBAR_TOGGLE_TOP_IN_ROW_PX}px`,
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle Sidebar"
            className="h-6 w-6 shrink-0 rounded-md p-0 text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
            onClick={onToggleSidebar}
          >
            <HugeiconsIcon
              icon={sidebarIcon}
              data-testid={sidebarIconTestId}
              className="transition-colors duration-150"
              style={{
                width: `${TOPBAR_TOGGLE_ICON_SIZE_PX}px`,
                height: `${TOPBAR_TOGGLE_ICON_SIZE_PX}px`,
              }}
            />
          </Button>
        </div>

        <div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center pr-4",
            collapsed ? "left-28" : "left-[calc(19rem+1rem)]",
          )}
        >
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm font-medium tracking-tight text-foreground">
              {pageTitle}
            </span>
          </div>

          <div className="window-no-drag ml-auto flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/70 px-2 py-1 text-[10px] text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: INSTANCE_COLOR }}
              />
              <span className="max-w-[9rem] truncate">{INSTANCE_LABEL}</span>
            </span>
            {showWorkControls ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md border-border/60 bg-card/70 px-2.5 text-[11px] leading-none"
                    >
                      {currentEditor?.iconSrc ? (
                        <img
                          src={currentEditor.iconSrc}
                          alt={`${currentEditor.label} icon`}
                          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] rounded-sm object-contain"
                        />
                      ) : (
                        <HugeiconsIcon
                          icon={FolderOpen}
                          className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]"
                        />
                      )}
                      Open
                      <HugeiconsIcon
                        icon={ChevronDown}
                        className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-sidebar-foreground/60"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {OPEN_TARGETS.map((target) => (
                      <DropdownMenuItem
                        key={target.id}
                        onSelect={() => {
                          onSelectEditor(target.id);
                          void onOpenTarget(target.id);
                        }}
                      >
                        <img
                          src={target.iconSrc}
                          alt={`${target.label} icon`}
                          className="mr-2 h-[var(--app-icon-size)] w-[var(--app-icon-size)] rounded-sm object-contain"
                        />
                        {target.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={onOpenTerminal}
                >
                  <HugeiconsIcon
                    icon={ComputerTerminal01Icon}
                    className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-sidebar-foreground/50"
                  />
                  <span className="sr-only">Open terminal</span>
                </Button>
              </>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={onOpenSearch}
            >
              <HugeiconsIcon
                icon={AiSearch02Icon}
                className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-sidebar-foreground/65"
              />
              <span className="sr-only">Search</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
