import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type CapsuleButtonGroupOption = {
  value: string;
  label: string;
  accent?: string;
};

type CapsuleButtonGroupProps = {
  className?: string;
  options: CapsuleButtonGroupOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  loop?: boolean;
  rovingFocus?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function CapsuleButtonGroup({
  className,
  options,
  ...props
}: CapsuleButtonGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      data-slot="capsule-button-group"
      className={cn("capsule-button-group", className)}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="capsule-button-group-item"
          style={
            option.accent
              ? ({
                  ["--capsule-item-accent" as string]: option.accent,
                } as React.CSSProperties)
              : undefined
          }
        >
          <span className="capsule-button-group-item-content">
            <span className="capsule-button-group-item-dot" aria-hidden="true">
              <span className="capsule-button-group-item-dot-core" />
            </span>
            <span>{option.label}</span>
          </span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
