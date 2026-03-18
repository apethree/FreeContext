import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function CapsuleCheckbox({
  className,
  style,
  accent,
  variant = "rounded",
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  accent?: string;
  variant?: "rounded" | "rectangular";
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="capsule-checkbox"
      data-variant={variant}
      className={cn(
        "capsule-checkbox",
        variant === "rectangular" && "capsule-checkbox--rectangular",
        className,
      )}
      style={
        accent
          ? ({
              ...style,
              ["--capsule-checkbox-accent" as string]: accent,
            } as React.CSSProperties)
          : style
      }
      {...props}
    >
      <span className="capsule-checkbox-highlight" aria-hidden="true" />
      <CheckboxPrimitive.Indicator forceMount className="capsule-checkbox-indicator">
        <span className="capsule-checkbox-center" aria-hidden="true">
          <span className="capsule-checkbox-center-ring" />
          <span className="capsule-checkbox-center-core" />
        </span>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
