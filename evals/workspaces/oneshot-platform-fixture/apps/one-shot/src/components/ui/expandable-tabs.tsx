"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useOnClickOutside } from "usehooks-ts";
import { cn } from "@/lib/utils";

type ExpandableTabIcon = React.ComponentType<{ className?: string }>;

export interface ExpandableTab {
  id: string;
  title: string;
  icon: ExpandableTabIcon;
  type?: never;
}

export interface ExpandableTabSeparator {
  id?: string;
  type: "separator";
  title?: never;
  icon?: never;
}

export type ExpandableTabItem = ExpandableTab | ExpandableTabSeparator;

interface ExpandableTabsProps {
  tabs: ExpandableTabItem[];
  className?: string;
  activeColor?: string;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string | null) => void;
}

const buttonVariants = {
  initial: {
    gap: 0,
    paddingLeft: ".5rem",
    paddingRight: ".5rem",
  },
  animate: (isSelected: boolean) => ({
    gap: isSelected ? ".45rem" : 0,
    paddingLeft: isSelected ? ".75rem" : ".5rem",
    paddingRight: isSelected ? ".75rem" : ".5rem",
  }),
};

const spanVariants = {
  initial: { width: 0, opacity: 0 },
  animate: { width: "auto", opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

const transition = {
  delay: 0.08,
  type: "spring" as const,
  bounce: 0,
  duration: 0.45,
};

export function ExpandableTabs({
  tabs,
  className,
  activeColor = "text-sidebar",
  value,
  defaultValue = null,
  onChange,
}: ExpandableTabsProps) {
  const [internalSelected, setInternalSelected] = React.useState<string | null>(
    defaultValue,
  );
  const isControlled = value !== undefined;
  const selected = isControlled ? value : internalSelected;
  const outsideClickRef = React.useRef<HTMLDivElement>(null);

  useOnClickOutside(
    outsideClickRef as React.RefObject<HTMLElement>,
    () => {
      if (isControlled) {
        onChange?.(null);
        return;
      }
      setInternalSelected(null);
      onChange?.(null);
    },
  );

  const handleSelect = (id: string) => {
    if (!isControlled) setInternalSelected(id);
    onChange?.(id);
  };

  return (
    <div
      ref={outsideClickRef}
      className={cn(
        "flex w-full items-center gap-1 rounded-xl bg-white/45 p-1.5 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.75)] backdrop-blur-md dark:bg-white/6 dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.12)]",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        if (tab.type === "separator") {
          return (
            <div
              key={tab.id ?? `separator-${index}`}
              className="mx-0.5 h-[18px] w-px bg-sidebar-border"
              aria-hidden="true"
            />
          );
        }

        const Icon = tab.icon;
        const isSelected = selected === tab.id;
        return (
          <motion.button
            key={tab.id}
            variants={buttonVariants}
            initial="initial"
            animate="animate"
            custom={isSelected}
            onClick={() => handleSelect(tab.id)}
            transition={transition}
            className={cn(
              "relative flex h-7 items-center rounded-lg py-1 text-[11px] font-medium transition-colors duration-200",
              isSelected
                ? cn(
                    "bg-sidebar-foreground text-sidebar shadow-[0_1px_1px_hsl(var(--sidebar-foreground)/0.2)]",
                    activeColor,
                  )
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <AnimatePresence initial={false}>
              {isSelected ? (
                <motion.span
                  variants={spanVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={transition}
                  className="overflow-hidden whitespace-nowrap"
                >
                  {tab.title}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </div>
  );
}
