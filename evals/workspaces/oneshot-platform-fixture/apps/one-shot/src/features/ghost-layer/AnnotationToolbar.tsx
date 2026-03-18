import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { AnnotationSessionMode, AnnotationShape, AnnotationToolType } from '@oneshot/annotation-core/types';
import { ANNOTATION_COLORS } from '@oneshot/annotation-core/types';
import { HugeiconsIcon, type IconSvgElement } from '@/components/ui/hugeicons-icon';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ALargeSmall,
  Cursor02Icon,
  PencilEdit02Icon,
  SettingsIcon,
  Mic02Icon,
  Delete01Icon,
  UndoIcon,
  RedoIcon,
  ArrowUpRight01Icon,
  MinusSignIcon,
  Tick01Icon,
  DashedLine01Icon,
  SolidLine01Icon,
} from '@hugeicons/core-free-icons';
import {
  ghostLayerActiveToolAtom,
  ghostLayerActiveColorAtom,
  ghostLayerAnnotationsAtom,
  ghostLayerAnnotatingAtom,
  ghostLayerSelectedShapeIdAtom,
  ghostLayerUndoStackAtom,
  ghostLayerRedoStackAtom,
  ghostLayerFreehandWidthAtom,
  ghostLayerFreehandStyleAtom,
  ghostLayerAutoMicAtom,
  ghostLayerStopPhraseAtom,
} from './annotation-state';

// -- Inline SVG icon definitions --
const CircleIconSvg: IconSvgElement = [
  ['circle', { cx: '12', cy: '12', r: '9', stroke: 'currentColor', strokeWidth: '1.5', fill: 'none' }],
];
const SquareIconSvg: IconSvgElement = [
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', stroke: 'currentColor', strokeWidth: '1.5', fill: 'none' }],
];
const HandIconSvg: IconSvgElement = [
  ['path', { d: 'M9 21v-8m0 0V7.5a1.5 1.5 0 0 1 3 0V13m0 0V6.5a1.5 1.5 0 0 1 3 0V14m0-5.5a1.5 1.5 0 0 1 3 0v7c0 3-2 5.5-5 5.5H11c-2.8 0-5-2.2-5-5v-3a1.5 1.5 0 0 1 3 0v2.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];
const ArrowDownSmallSvg: IconSvgElement = [
  ['path', { d: 'M6 9l6 6 6-6', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];
const LassoIconSvg: IconSvgElement = [
  ['path', { d: 'M5 12C5 8.13 8.13 5 12 5s7 3.13 7 7c0 2-1 3.5-2.5 4.5M12 19c-1.5 0-3-.5-4-1.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', fill: 'none' }],
  ['path', { d: 'M8 19l-3 1 1-3', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];
const CollapseIconSvg: IconSvgElement = [
  ['path', { d: 'M4 6h16M4 12h16M4 18h16', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }],
];
const ShareIconSvg: IconSvgElement = [
  ['path', { d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];
const CopyIconSvg: IconSvgElement = [
  ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', stroke: 'currentColor', strokeWidth: '1.5', fill: 'none' }],
  ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1', stroke: 'currentColor', strokeWidth: '1.5', fill: 'none' }],
];
const DownloadIconSvg: IconSvgElement = [
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];
const SendIconSvg: IconSvgElement = [
  ['path', { d: 'M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }],
];

type ShapeTool = 'circle' | 'rect' | 'arrow' | 'line';
type MicStatusState = 'idle' | 'preparing' | 'listening' | 'processing' | 'error';
const SHAPE_TOOLS: { key: ShapeTool; label: string; icon: IconSvgElement }[] = [
  { key: 'rect', label: 'Rectangle', icon: SquareIconSvg },
  { key: 'circle', label: 'Circle', icon: CircleIconSvg },
  { key: 'arrow', label: 'Arrow', icon: ArrowUpRight01Icon },
  { key: 'line', label: 'Line', icon: MinusSignIcon },
];

const WIDTH_OPTIONS = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 3 },
  { label: 'Wide', value: 5 },
] as const;

// ---------- Semantic tokens ----------

const BTN_INACTIVE = '[color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)] font-medium transition-colors';
const BTN_ACTIVE = 'bg-[var(--dock-surface-active)] [color:var(--dock-fg)] font-semibold';
const TOOLTIP_CLS = 'bg-[#0a1628]/95 text-white border-blue-400/20 text-xs';

function Divider() {
  return <div className="h-5 w-px bg-[var(--dock-divider)]" />;
}

function getMicErrorLabel(detail: string | null | undefined): string {
  if (!detail) return 'Microphone unavailable';
  const lowered = detail.toLowerCase();
  if (lowered.includes('permission') || lowered.includes('notallowed')) {
    return 'Microphone permission blocked';
  }
  if (lowered.includes('device') || lowered.includes('notfound')) {
    return 'No microphone device found';
  }
  return detail;
}

// ---------- Sub-components ----------

function ToolbarIconButton({
  icon,
  label,
  shortcut,
  isActive,
  onClick,
  disabled,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  shortcut?: string;
  isActive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={disabled}
          className={cn(
            'min-w-8 min-h-8 rounded-lg p-1.5 transition-colors outline-none flex items-center justify-center',
            isActive ? BTN_ACTIVE : BTN_INACTIVE,
            disabled && 'opacity-30 pointer-events-none',
            className,
          )}
        >
          <HugeiconsIcon icon={icon} size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className={TOOLTIP_CLS}>
        {label}
        {shortcut ? ` (${shortcut})` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

function ShapesDropdown({
  activeTool,
  setActiveTool,
}: {
  activeTool: AnnotationToolType;
  setActiveTool: (t: AnnotationToolType) => void;
}) {
  const [lastShapeTool, setLastShapeTool] = useState<ShapeTool>('rect');
  const isShapeActive = (
    ['circle', 'rect', 'arrow', 'line'] as string[]
  ).includes(activeTool);
  const currentIcon =
    SHAPE_TOOLS.find((t) => t.key === (isShapeActive ? activeTool : lastShapeTool))?.icon ??
    SquareIconSvg;

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setActiveTool(lastShapeTool)}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'min-h-8 rounded-lg rounded-r-none p-1.5 transition-colors outline-none',
              isShapeActive ? BTN_ACTIVE : BTN_INACTIVE,
            )}
          >
            <HugeiconsIcon icon={currentIcon} size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className={TOOLTIP_CLS}>
          Shapes ({lastShapeTool[0].toUpperCase()})
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'min-h-8 rounded-lg rounded-l-none p-1 transition-colors outline-none',
              'data-[state=open]:bg-white/20 data-[state=open]:text-white',
              isShapeActive ? BTN_ACTIVE : BTN_INACTIVE,
            )}
          >
            <HugeiconsIcon icon={ArrowDownSmallSvg} size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="min-w-[140px] bg-[#0a1628]/95 border-blue-400/20 text-white backdrop-blur-xl"
        >
          {SHAPE_TOOLS.map((tool) => (
            <DropdownMenuItem
              key={tool.key}
              onClick={() => {
                setActiveTool(tool.key);
                setLastShapeTool(tool.key);
              }}
              className="gap-2 text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
            >
              <HugeiconsIcon icon={tool.icon} size={14} />
              {tool.label}
              {activeTool === tool.key && (
                <HugeiconsIcon icon={Tick01Icon} size={12} className="ml-auto text-blue-300/80" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PencilDropdown({
  activeTool,
  setActiveTool,
  onSwitchToAnnotate,
}: {
  activeTool: AnnotationToolType;
  setActiveTool: (t: AnnotationToolType) => void;
  onSwitchToAnnotate?: () => void;
}) {
  const [freehandWidth, setFreehandWidth] = useAtom(ghostLayerFreehandWidthAtom);
  const [freehandStyle, setFreehandStyle] = useAtom(ghostLayerFreehandStyleAtom);
  const isActive = activeTool === 'freehand';

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              onSwitchToAnnotate?.();
              setActiveTool('freehand');
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'min-h-8 rounded-lg rounded-r-none p-1.5 transition-colors outline-none',
              isActive ? BTN_ACTIVE : BTN_INACTIVE,
            )}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className={TOOLTIP_CLS}>
          Draw (D)
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'min-h-8 rounded-lg rounded-l-none p-1 transition-colors outline-none',
              'data-[state=open]:bg-white/20 data-[state=open]:text-white',
              isActive ? BTN_ACTIVE : BTN_INACTIVE,
            )}
          >
            <HugeiconsIcon icon={ArrowDownSmallSvg} size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="min-w-[120px] bg-[#0a1628]/95 border-blue-400/20 text-white backdrop-blur-xl"
        >
          {WIDTH_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setFreehandWidth(opt.value)}
              className="gap-2 text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
            >
              <span
                className="inline-block rounded-full bg-white/70"
                style={{ width: 20, height: opt.value }}
              />
              {opt.label}
              {freehandWidth === opt.value && (
                <HugeiconsIcon icon={Tick01Icon} size={12} className="ml-auto text-blue-300/80" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="bg-white/[0.1]" />
          <DropdownMenuItem
            onClick={() => setFreehandStyle('solid')}
            className="gap-2 text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
          >
            <HugeiconsIcon icon={SolidLine01Icon} size={14} />
            Solid
            {freehandStyle === 'solid' && (
              <HugeiconsIcon icon={Tick01Icon} size={12} className="ml-auto text-blue-300/80" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setFreehandStyle('dashed')}
            className="gap-2 text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
          >
            <HugeiconsIcon icon={DashedLine01Icon} size={14} />
            Dashed
            {freehandStyle === 'dashed' && (
              <HugeiconsIcon icon={Tick01Icon} size={12} className="ml-auto text-blue-300/80" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------- Collapsed dock content ----------

function DockCollapsedContent({
  isAnnotating,
  onToggleDockCollapsed,
  onToggleAnnotating,
  onSwitchToAnnotate,
}: {
  isAnnotating: boolean;
  onToggleDockCollapsed: () => void;
  onToggleAnnotating: () => void;
  onSwitchToAnnotate?: () => void;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => {
              onSwitchToAnnotate?.();
              if (isAnnotating) {
                onToggleDockCollapsed();
                return;
              }
              onToggleAnnotating();
              onToggleDockCollapsed();
            }}
            aria-label={isAnnotating ? 'Expand toolbar' : 'Start annotating'}
            className={cn(
              'min-w-8 min-h-8 rounded-lg p-1.5 outline-none flex items-center justify-center',
              BTN_INACTIVE,
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className={TOOLTIP_CLS}>
          {isAnnotating ? 'Expand toolbar' : 'Start annotating (Cmd+Shift+A)'}
        </TooltipContent>
      </Tooltip>
      <div className="mx-0.5 h-5 w-px bg-[var(--dock-divider)]" />
      <div className="flex items-center gap-1.5 pr-1.5">
        <span className="whitespace-nowrap text-[12px] font-semibold [color:var(--dock-fg)]">
          OneShot Point
        </span>
      </div>
    </>
  );
}

// ---------- Expanded dock content ----------

function DockExpandedContent({
  activeTool,
  setActiveTool,
  isAnnotating,
  onToggleDockCollapsed,
  onSwitchToAnnotate,
  activeColor,
  setActiveColor,
  undoStack,
  redoStack,
  onUndo,
  onRedo,
  isRecording,
  onStartRecording,
  onStopRecording,
  autoMic,
  onToggleAutoMic,
  selectedId,
  onDeleteSelected,
  annotations,
  onClearAll,
  onOpenDockPanel,
  sttState,
  sttErrorDetail,
  onRetryMic,
}: {
  activeTool: AnnotationToolType;
  setActiveTool: (t: AnnotationToolType) => void;
  isAnnotating: boolean;
  onToggleDockCollapsed: () => void;
  onSwitchToAnnotate?: () => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
  undoStack: AnnotationShape[][];
  redoStack: AnnotationShape[][];
  onUndo: () => void;
  onRedo: () => void;
  isRecording: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  autoMic: boolean;
  onToggleAutoMic: () => void;
  selectedId: string | null;
  onDeleteSelected: () => void;
  annotations: AnnotationShape[];
  onClearAll: () => void;
  onOpenDockPanel: (panel: 'settings' | 'share') => void;
  sttState: MicStatusState;
  sttErrorDetail?: string | null;
  onRetryMic?: () => void;
}) {
  const micErrorLabel = getMicErrorLabel(sttErrorDetail);

  return (
    <>
      {/* Collapse */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleDockCollapsed}
            aria-label="Collapse toolbar"
            className={cn(
              'min-w-8 min-h-8 rounded-lg p-1.5 outline-none flex items-center justify-center',
              BTN_INACTIVE,
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <HugeiconsIcon icon={CollapseIconSvg} size={16} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className={TOOLTIP_CLS}>Collapse</TooltipContent>
      </Tooltip>

      {isAnnotating && (
        <>
          <Divider />

          {/* Select */}
          <ToolbarIconButton
            icon={Cursor02Icon}
            label="Select"
            shortcut="V"
            isActive={activeTool === 'select'}
            onClick={() => setActiveTool('select')}
          />

          {/* Grab */}
          <ToolbarIconButton
            icon={HandIconSvg}
            label="Grab / Move"
            shortcut="H"
            isActive={activeTool === 'grab'}
            onClick={() => setActiveTool('grab')}
          />

          {/* Shapes */}
          <ShapesDropdown activeTool={activeTool} setActiveTool={setActiveTool} />

          {/* Text */}
          <ToolbarIconButton
            icon={ALargeSmall}
            label="Text"
            shortcut="T"
            isActive={activeTool === 'text'}
            onClick={() => setActiveTool('text')}
          />

          {/* Pencil */}
          <PencilDropdown
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            onSwitchToAnnotate={onSwitchToAnnotate}
          />

          {/* Lasso */}
          <ToolbarIconButton
            icon={LassoIconSvg}
            label="Magic Lasso — capture region"
            shortcut="W"
            isActive={activeTool === 'lasso'}
            onClick={() => setActiveTool('lasso')}
          />

          <Divider />

          {/* Color picker */}
          <div className="flex items-center gap-1">
            {ANNOTATION_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setActiveColor(color)}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  'h-3.5 w-3.5 rounded-full border transition-transform outline-none',
                  activeColor === color
                    ? 'scale-125 border-white shadow-[0_0_6px_2px_rgba(255,255,255,0.3)]'
                    : 'border-white/20 hover:scale-110',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <Divider />

          {/* Undo / Redo */}
          <ToolbarIconButton
            icon={UndoIcon}
            label="Undo"
            shortcut="Cmd+Z"
            disabled={undoStack.length === 0}
            onClick={onUndo}
          />
          <ToolbarIconButton
            icon={RedoIcon}
            label="Redo"
            shortcut="Cmd+Shift+Z"
            disabled={redoStack.length === 0}
            onClick={onRedo}
          />

          <Divider />

          {/* Mic */}
          {onStartRecording && onStopRecording && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={isRecording ? onStopRecording : onStartRecording}
                  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                  className={cn(
                    'min-w-8 min-h-8 rounded-lg p-1.5 transition-colors outline-none flex items-center justify-center',
                    isRecording ? 'bg-red-500/20 text-red-400' : BTN_INACTIVE,
                  )}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {isRecording ? (
                    <span className="flex h-4 w-4 items-center justify-center">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    </span>
                  ) : (
                    <HugeiconsIcon icon={Mic02Icon} size={16} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className={TOOLTIP_CLS}>
                {isRecording ? 'Stop recording' : 'Dictate (Space)'}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Auto-mic */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleAutoMic}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  'min-h-8 rounded-md px-2 py-0.5 text-[12px] font-semibold transition-colors outline-none',
                  autoMic ? BTN_ACTIVE : BTN_INACTIVE,
                )}
              >
                Auto
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className={TOOLTIP_CLS}>
              {autoMic ? 'Auto-dictate on (click to disable)' : 'Enable auto-dictate'}
            </TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onOpenDockPanel('settings')}
                aria-label="Settings"
                className={cn(
                  'min-w-8 min-h-8 rounded-lg p-1.5 outline-none flex items-center justify-center',
                  BTN_INACTIVE,
                )}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <HugeiconsIcon icon={SettingsIcon} size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className={TOOLTIP_CLS}>Settings</TooltipContent>
          </Tooltip>

          <Divider />

          {/* Delete */}
          <ToolbarIconButton
            icon={Delete01Icon}
            label="Delete selected"
            disabled={!selectedId}
            onClick={onDeleteSelected}
            className={selectedId ? 'text-red-400/80 hover:text-red-300 hover:bg-red-500/10' : ''}
          />

          {/* Clear */}
          <button
            onClick={onClearAll}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={annotations.length === 0}
            className={cn(
              'min-h-8 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors outline-none',
              BTN_INACTIVE,
              'disabled:opacity-30 disabled:pointer-events-none',
            )}
          >
            Clear
          </button>

          {sttState === 'error' && (
            <div className="ml-1 flex max-w-[220px] items-center gap-1.5 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-1">
              <span className="truncate text-[11px] font-semibold text-red-200" title={micErrorLabel}>
                {micErrorLabel}
              </span>
              {onRetryMic && (
                <button
                  type="button"
                  onClick={onRetryMic}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="rounded-md border border-red-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-100 hover:bg-red-500/15"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <Divider />

          {/* Share */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onOpenDockPanel('share')}
                aria-label="Share / Export"
                disabled={annotations.length === 0}
                className={cn(
                  'min-w-8 min-h-8 rounded-lg p-1.5 outline-none flex items-center justify-center',
                  BTN_INACTIVE,
                  'disabled:opacity-30 disabled:pointer-events-none',
                )}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <HugeiconsIcon icon={ShareIconSvg} size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className={TOOLTIP_CLS}>Share / Export</TooltipContent>
          </Tooltip>
        </>
      )}

      {!isAnnotating && annotations.length > 0 && (
        <span className="ml-1 text-[12px] font-semibold [color:var(--dock-fg)]">
          {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
        </span>
      )}
    </>
  );
}

// ---------- Settings panel content ----------

function SettingsPanelContent({
  stopPhraseDraft,
  onStopPhraseDraftChange,
  onApplyStopPhrase,
  onResetStopPhrase,
  autoMic,
  onToggleAutoMic,
  sessionMode,
  onSessionModeChange,
  onResetSession,
  sttState,
  sttErrorDetail,
  onRetryMic,
}: {
  stopPhraseDraft: string;
  onStopPhraseDraftChange: (v: string) => void;
  onApplyStopPhrase: () => void;
  onResetStopPhrase: () => void;
  autoMic: boolean;
  onToggleAutoMic: () => void;
  sessionMode: AnnotationSessionMode;
  onSessionModeChange: (mode: AnnotationSessionMode) => void;
  onResetSession: () => void;
  sttState: MicStatusState;
  sttErrorDetail?: string | null;
  onRetryMic?: () => void;
}) {
  const micErrorLabel = getMicErrorLabel(sttErrorDetail);

  return (
    <div className="space-y-3.5 pt-1">
      {sttState === 'error' && (
        <div className="rounded-lg border border-red-500/35 bg-red-500/10 px-2.5 py-2">
          <p className="text-[12px] font-semibold text-red-100">Microphone issue</p>
          <p className="mt-1 text-[11px] font-medium text-red-200/90">{micErrorLabel}</p>
          {onRetryMic && (
            <button
              type="button"
              onClick={onRetryMic}
              className="mt-2 rounded-md border border-red-400/35 px-2 py-1 text-[11px] font-semibold text-red-100 hover:bg-red-500/15"
            >
              Retry microphone
            </button>
          )}
        </div>
      )}
      <div>
        <p className="text-[12px] font-semibold [color:var(--dock-fg)]">Stop phrase</p>
        <p className="mt-0.5 text-[11px] font-medium [color:var(--dock-fg-muted)]">
          Use one phrase or comma-separated phrases.
        </p>
      </div>
      <Input
        value={stopPhraseDraft}
        onChange={(e) => onStopPhraseDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onApplyStopPhrase();
          }
        }}
        placeholder="done"
        className="h-9 border-[var(--dock-divider)] bg-[var(--dock-surface-active)] px-2 text-[12px] font-medium [color:var(--dock-fg)] placeholder:[color:var(--dock-fg-disabled)] focus-visible:border-blue-300/40 focus-visible:ring-blue-300/20"
      />
      <div className="flex items-center gap-1.5">
        <button
          onClick={onApplyStopPhrase}
          className="rounded-md bg-blue-500/30 px-2 py-1 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/40"
        >
          Save
        </button>
        <button
          onClick={onResetStopPhrase}
          className="rounded-md border border-[var(--dock-divider)] px-2 py-1 text-[11px] font-semibold [color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)]"
        >
          Reset
        </button>
      </div>

      <div className="h-px bg-[var(--dock-divider)]" />

      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold [color:var(--dock-fg)]">Auto-mic</p>
        <button
          onClick={onToggleAutoMic}
          className={cn(
            'h-5 w-9 rounded-full transition-colors',
            autoMic ? 'bg-blue-500' : 'bg-[var(--dock-surface-active)]',
          )}
          aria-pressed={autoMic}
        >
          <span
            className={cn(
              'block h-4 w-4 rounded-full bg-white shadow transition-transform mx-0.5',
              autoMic ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <div className="h-px bg-[var(--dock-divider)]" />

      <div>
        <p className="text-[12px] font-semibold [color:var(--dock-fg)]">Context</p>
        <p className="mt-0.5 text-[11px] font-medium [color:var(--dock-fg-muted)]">
          Multi-resource keeps separate steps per surface.
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSessionModeChange('multi-resource')}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
              sessionMode === 'multi-resource'
                ? 'bg-blue-500/30 text-blue-100 ring-1 ring-blue-300/35'
                : 'border border-[var(--dock-divider)] [color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)]',
            )}
          >
            Multi-resource
          </button>
          <button
            type="button"
            onClick={() => onSessionModeChange('single-resource')}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
              sessionMode === 'single-resource'
                ? 'bg-blue-500/30 text-blue-100 ring-1 ring-blue-300/35'
                : 'border border-[var(--dock-divider)] [color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)]',
            )}
          >
            Single-resource
          </button>
        </div>
      </div>

      <div className="h-px bg-[var(--dock-divider)]" />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold [color:var(--dock-fg)]">Session</p>
          <p className="text-[11px] font-medium [color:var(--dock-fg-muted)]">Clear resources and annotations.</p>
        </div>
        <button
          type="button"
          onClick={onResetSession}
          className="rounded-md border border-red-400/35 px-2 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/10"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ---------- Share panel content ----------

function SharePanelContent({
  onShareCopy,
  onShareToChat,
  onShareDownload,
}: {
  onShareCopy: () => void;
  onShareToChat: () => void;
  onShareDownload: () => void;
}) {
  return (
    <div className="space-y-2 pt-1">
      <button
        onClick={onShareCopy}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] font-semibold [color:var(--dock-fg)] hover:bg-[var(--dock-surface-active)] transition-colors"
      >
        <HugeiconsIcon icon={CopyIconSvg} size={15} className="[color:var(--dock-fg-muted)]" />
        Copy Session JSON
      </button>
      <button
        onClick={onShareToChat}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] font-semibold [color:var(--dock-fg)] hover:bg-[var(--dock-surface-active)] transition-colors"
      >
        <HugeiconsIcon icon={SendIconSvg} size={15} className="[color:var(--dock-fg-muted)]" />
        Send to Chat
      </button>
      <button
        onClick={onShareDownload}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12px] font-semibold [color:var(--dock-fg)] hover:bg-[var(--dock-surface-active)] transition-colors"
      >
        <HugeiconsIcon icon={DownloadIconSvg} size={15} className="[color:var(--dock-fg-muted)]" />
        Download JSON
      </button>
    </div>
  );
}

// ---------- Backtray panel ----------

function DockBacktrayPanel({
  activeDockPanel,
  onClose,
  onShareCopy,
  onShareToChat,
  onShareDownload,
  stopPhraseDraft,
  onStopPhraseDraftChange,
  onApplyStopPhrase,
  onResetStopPhrase,
  autoMic,
  onToggleAutoMic,
  sessionMode,
  onSessionModeChange,
  onResetSession,
  sttState,
  sttErrorDetail,
  onRetryMic,
}: {
  activeDockPanel: 'none' | 'settings' | 'share';
  onClose: () => void;
  onShareCopy: () => void;
  onShareToChat: () => void;
  onShareDownload: () => void;
  stopPhraseDraft: string;
  onStopPhraseDraftChange: (v: string) => void;
  onApplyStopPhrase: () => void;
  onResetStopPhrase: () => void;
  autoMic: boolean;
  onToggleAutoMic: () => void;
  sessionMode: AnnotationSessionMode;
  onSessionModeChange: (mode: AnnotationSessionMode) => void;
  onResetSession: () => void;
  sttState: MicStatusState;
  sttErrorDetail?: string | null;
  onRetryMic?: () => void;
}) {
  const [isMounted, setIsMounted] = useState(activeDockPanel !== 'none');
  const [isExiting, setIsExiting] = useState(false);
  const [currentPanel, setCurrentPanel] = useState<'settings' | 'share'>(
    activeDockPanel !== 'none' ? activeDockPanel : 'settings',
  );

  useEffect(() => {
    if (activeDockPanel !== 'none') {
      setCurrentPanel(activeDockPanel);
      setIsMounted(true);
      setIsExiting(false);
    } else if (isMounted) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setIsMounted(false);
        setIsExiting(false);
      }, 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeDockPanel, isMounted]);

  if (!isMounted) return null;

  const title = currentPanel === 'settings' ? 'Settings' : 'Share';

  return (
    <div
      className={cn(
        'relative -mb-2 w-[320px] rounded-t-[20px] rounded-b-none p-3.5 toolbar-glass',
        isExiting ? 'backtray-exit' : 'backtray-enter',
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold [color:var(--dock-fg)]">{title}</p>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-lg px-2 py-1 text-[12px] font-semibold [color:var(--dock-fg-muted)] hover:bg-[var(--dock-surface-active)] hover:[color:var(--dock-fg)] transition-colors"
        >
          Close
        </button>
      </div>
      <div className="h-px bg-[var(--dock-divider)] mb-2" />

      {currentPanel === 'settings' && (
        <SettingsPanelContent
          stopPhraseDraft={stopPhraseDraft}
          onStopPhraseDraftChange={onStopPhraseDraftChange}
          onApplyStopPhrase={onApplyStopPhrase}
          onResetStopPhrase={onResetStopPhrase}
          autoMic={autoMic}
          onToggleAutoMic={onToggleAutoMic}
          sessionMode={sessionMode}
          onSessionModeChange={onSessionModeChange}
          onResetSession={onResetSession}
          sttState={sttState}
          sttErrorDetail={sttErrorDetail}
          onRetryMic={onRetryMic}
        />
      )}
      {currentPanel === 'share' && (
        <SharePanelContent
          onShareCopy={onShareCopy}
          onShareToChat={onShareToChat}
          onShareDownload={onShareDownload}
        />
      )}
    </div>
  );
}

// ---------- Props ----------

export type AnnotationToolbarProps = {
  onToggleAnnotating: () => void;
  onSwitchToAnnotate?: () => void;
  isInteracting?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  sttState?: MicStatusState;
  sttErrorDetail?: string | null;
  onRetryMic?: () => void;
  sessionMode: AnnotationSessionMode;
  onSessionModeChange: (mode: AnnotationSessionMode) => void;
  onResetSession: () => void;
  isRecording?: boolean;
  // Dock V3
  isDockCollapsed: boolean;
  onToggleDockCollapsed: () => void;
  activeDockPanel: 'none' | 'settings' | 'share';
  onOpenDockPanel: (panel: 'settings' | 'share') => void;
  onCloseDockPanel: () => void;
  onShareCopy: () => void;
  onShareToChat: () => void;
  onShareDownload: () => void;
  onDockPointerDown: (e: React.PointerEvent) => void;
  onDockPointerMove: (e: React.PointerEvent) => void;
  onDockPointerUp: (e: React.PointerEvent) => void;
};

// ---------- Main Component ----------

export function AnnotationToolbar(props: AnnotationToolbarProps) {
  const {
    isDockCollapsed,
    onToggleDockCollapsed,
    activeDockPanel,
    onOpenDockPanel,
    onCloseDockPanel,
    onShareCopy,
    onShareToChat,
    onShareDownload,
    onSwitchToAnnotate,
    isInteracting = false,
    onStartRecording,
    onStopRecording,
    isRecording = false,
    sttState = 'idle',
    sttErrorDetail = null,
    onRetryMic,
    sessionMode,
    onSessionModeChange,
    onResetSession,
    onToggleAnnotating,
  } = props;

  const [activeTool, setActiveTool] = useAtom(ghostLayerActiveToolAtom);
  const [activeColor, setActiveColor] = useAtom(ghostLayerActiveColorAtom);
  const [annotations, setAnnotations] = useAtom(ghostLayerAnnotationsAtom);
  const [selectedId, setSelectedId] = useAtom(ghostLayerSelectedShapeIdAtom);
  const isAnnotating = useAtomValue(ghostLayerAnnotatingAtom);
  const [undoStack, setUndoStack] = useAtom(ghostLayerUndoStackAtom);
  const [redoStack, setRedoStack] = useAtom(ghostLayerRedoStackAtom);
  const [autoMic, setAutoMic] = useAtom(ghostLayerAutoMicAtom);
  const [stopPhrase, setStopPhrase] = useAtom(ghostLayerStopPhraseAtom);
  const [stopPhraseDraft, setStopPhraseDraft] = useState(stopPhrase);

  const toolbarRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStopPhraseDraft(stopPhrase);
  }, [stopPhrase]);

  // Close backtray on outside click
  useEffect(() => {
    if (activeDockPanel === 'none') return;
    const handler = (e: PointerEvent) => {
      if (!toolbarRootRef.current?.contains(e.target as Node)) {
        onCloseDockPanel();
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [activeDockPanel, onCloseDockPanel]);

  const applyStopPhrase = useCallback(() => {
    const normalized = stopPhraseDraft
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
    setStopPhrase(normalized || 'done');
    onCloseDockPanel();
  }, [stopPhraseDraft, setStopPhrase, onCloseDockPanel]);

  const onUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, annotations]);
    setAnnotations(previous);
    setUndoStack((prev) => prev.slice(0, -1));
  }, [undoStack, annotations, setAnnotations, setUndoStack, setRedoStack]);

  const onRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, annotations]);
    setAnnotations(next);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, annotations, setAnnotations, setUndoStack, setRedoStack]);

  const onDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, annotations, setAnnotations, setSelectedId, setUndoStack, setRedoStack]);

  const onClearAll = useCallback(() => {
    if (annotations.length === 0) return;
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack([]);
    setAnnotations([]);
    setSelectedId(null);
  }, [annotations, setAnnotations, setSelectedId, setUndoStack, setRedoStack]);

  return (
    <div
      ref={toolbarRootRef}
      className="relative flex flex-col items-center gap-2 cursor-grab active:cursor-grabbing select-none"
      onPointerDown={props.onDockPointerDown}
      onPointerMove={props.onDockPointerMove}
      onPointerUp={props.onDockPointerUp}
    >
      {/* Backtray panel — above the glass pill */}
      <DockBacktrayPanel
        activeDockPanel={activeDockPanel}
        onClose={onCloseDockPanel}
        onShareCopy={onShareCopy}
        onShareToChat={onShareToChat}
        onShareDownload={onShareDownload}
        stopPhraseDraft={stopPhraseDraft}
        onStopPhraseDraftChange={setStopPhraseDraft}
        onApplyStopPhrase={applyStopPhrase}
        onResetStopPhrase={() => { setStopPhraseDraft('done'); setStopPhrase('done'); }}
        autoMic={autoMic}
        onToggleAutoMic={() => setAutoMic((prev) => !prev)}
        sessionMode={sessionMode}
        onSessionModeChange={onSessionModeChange}
        onResetSession={onResetSession}
        sttState={sttState}
        sttErrorDetail={sttErrorDetail}
        onRetryMic={onRetryMic}
      />

      {/* Glass pill */}
      <div
        className={cn(
          'flex items-center gap-1 rounded-[22px] px-2.5 py-1.5 transition-all duration-300',
          isRecording && 'ring-2 ring-red-500/40',
          isInteracting ? 'toolbar-glass-interact' : 'toolbar-glass',
        )}
      >
        {isDockCollapsed ? (
          <DockCollapsedContent
            isAnnotating={isAnnotating}
            onToggleDockCollapsed={onToggleDockCollapsed}
            onToggleAnnotating={onToggleAnnotating}
            onSwitchToAnnotate={onSwitchToAnnotate}
          />
        ) : (
          <DockExpandedContent
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            isAnnotating={isAnnotating}
            onToggleDockCollapsed={onToggleDockCollapsed}
            onSwitchToAnnotate={onSwitchToAnnotate}
            activeColor={activeColor}
            setActiveColor={setActiveColor}
            undoStack={undoStack}
            redoStack={redoStack}
            onUndo={onUndo}
            onRedo={onRedo}
            isRecording={isRecording}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            autoMic={autoMic}
            onToggleAutoMic={() => setAutoMic((prev) => !prev)}
            selectedId={selectedId}
            onDeleteSelected={onDeleteSelected}
            annotations={annotations}
            onClearAll={onClearAll}
            onOpenDockPanel={onOpenDockPanel}
            sttState={sttState}
            sttErrorDetail={sttErrorDetail}
            onRetryMic={onRetryMic}
          />
        )}
      </div>
    </div>
  );
}
