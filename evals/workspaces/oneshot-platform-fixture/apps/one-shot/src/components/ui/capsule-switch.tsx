import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function CapsuleSwitch({
  className,
  style,
  accent,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  accent?: string;
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="capsule-switch"
      className={cn("capsule-switch", className)}
      style={
        accent
          ? ({
              ...style,
              ["--capsule-switch-accent" as string]: accent,
            } as React.CSSProperties)
          : style
      }
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="capsule-switch-thumb" className="capsule-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
