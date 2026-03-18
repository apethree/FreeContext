import * as React from "react";
import { cn } from "@/lib/utils";

export function CapsuleInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="capsule-input" className={cn("capsule-input", className)} {...props} />;
}
