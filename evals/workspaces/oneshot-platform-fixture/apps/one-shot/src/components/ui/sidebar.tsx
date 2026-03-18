import * as React from "react";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  open: boolean;
  state: "expanded" | "collapsed";
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}

export function SidebarProvider({
  children,
  open: openProp,
  onOpenChange,
}: React.PropsWithChildren<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>) {
  const [internalOpen, setInternalOpen] = React.useState(true);
  const open = openProp ?? internalOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen);
      if (openProp === undefined) {
        setInternalOpen(nextOpen);
      }
    },
    [onOpenChange, openProp],
  );

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      open,
      state: open ? "expanded" : "collapsed",
      setOpen,
      toggleSidebar: () => setOpen(!open),
    }),
    [open, setOpen],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function Sidebar({
  className,
  children,
  widthPx,
  minWidthPx = 200,
  maxWidthPx = 280,
  onResizeWidthPx,
}: React.PropsWithChildren<{
  className?: string;
  widthPx?: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onResizeWidthPx?: (nextWidthPx: number) => void;
}>) {
  const { open } = useSidebar();
  const widthValue =
    typeof widthPx === "number" && Number.isFinite(widthPx)
      ? Math.round(widthPx)
      : 304;
  const clamp = React.useCallback(
    (value: number) =>
      Math.min(maxWidthPx, Math.max(minWidthPx, Math.round(value))),
    [maxWidthPx, minWidthPx],
  );
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open || !onResizeWidthPx) return;
      event.preventDefault();
      event.stopPropagation();

      dragRef.current = { startX: event.clientX, startWidth: widthValue };

      const onMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = moveEvent.clientX - drag.startX;
        onResizeWidthPx(clamp(drag.startWidth + delta));
      };

      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clamp, onResizeWidthPx, open, widthValue],
  );

  return (
    <aside
      data-slot="sidebar"
      data-sidebar="sidebar"
      style={
        {
          ["--sidebar-width" as never]: `${widthValue}px`,
        } as React.CSSProperties
      }
      className={cn(
        "relative z-30 flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        open
          ? "w-[var(--sidebar-width)]"
          : "w-0 overflow-hidden border-transparent",
        className,
      )}
    >
      {children}

      {open && onResizeWidthPx ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onPointerDown}
          className={cn(
            "absolute -right-1 top-0 z-50 h-full w-3 cursor-col-resize touch-none",
            "hover:bg-sidebar-accent/20",
          )}
        />
      ) : null}
    </aside>
  );
}

export function SidebarInset({
  className,
  children,
}: React.PropsWithChildren<{
  className?: string;
}>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
    >
      {children}
    </main>
  );
}

export function SidebarContent({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col p-2", className)}
    >
      {children}
    </div>
  );
}

export function SidebarFooter({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div data-slot="sidebar-footer" className={cn("p-2", className)}>
      {children}
    </div>
  );
}

export function SidebarGroup({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <section
      data-slot="sidebar-group"
      className={cn("flex min-h-0 flex-col", className)}
    >
      {children}
    </section>
  );
}

export function SidebarGroupLabel({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarGroupContent({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("w-full text-sm", className)}
    >
      {children}
    </div>
  );
}

export function SidebarMenu({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("m-0 list-none space-y-1 p-0", className)}
    >
      {children}
    </ul>
  );
}

export function SidebarMenuItem({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/menu-item", className)}
    >
      {children}
    </li>
  );
}

export function SidebarMenuButton({
  className,
  isActive,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isActive?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-active={isActive ? "true" : undefined}
      className={cn(
        "sidebar-selection-shell flex h-8 w-full items-center gap-2 px-2 text-left text-responsive-sm font-medium leading-[1.2]",
        isActive
          ? "sidebar-selection-active text-sidebar-foreground"
          : "sidebar-selection-clear text-sidebar-foreground/75 hover:text-sidebar-foreground",
        className,
      )}
      {...props}
    >
      {isActive ? (
        <span aria-hidden="true" className="sidebar-selection-indicator" />
      ) : null}
      {children}
    </button>
  );
}
