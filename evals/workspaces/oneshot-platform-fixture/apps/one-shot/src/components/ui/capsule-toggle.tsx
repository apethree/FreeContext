import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

export type CapsuleToggleOption = {
  value: string;
  label: string;
  accent?: string;
};

type CapsuleToggleProps = Omit<React.ComponentProps<typeof RadioGroupPrimitive.Root>, "children"> & {
  options: CapsuleToggleOption[];
  size?: "sm" | "md" | "lg";
};

export function CapsuleToggle({
  className,
  options,
  size = "md",
  ...props
}: CapsuleToggleProps) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="capsule-toggle"
      data-size={size}
      className={cn("capsule-toggle-root", className)}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          data-slot="capsule-toggle-item"
          className="capsule-toggle-item"
          style={
            option.accent
              ? ({
                  ["--capsule-item-accent" as string]: option.accent,
                } as React.CSSProperties)
              : undefined
          }
          aria-label={option.label}
        >
          <span className="capsule-toggle-item-bg" aria-hidden="true" />
          <span className="capsule-toggle-item-content">
            <span className="capsule-toggle-item-dot" aria-hidden="true">
              <span className="capsule-toggle-item-dot-core" />
            </span>
            <span className="capsule-toggle-item-label">{option.label}</span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
