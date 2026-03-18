import * as React from "react";
import { cn } from "@/lib/utils";

export function CapsuleCard({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="capsule-card" className={cn("capsule-card", className)} {...props} />;
}

export function CapsuleCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="capsule-card-header" className={cn("capsule-card-header", className)} {...props} />;
}

export function CapsuleCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="capsule-card-title" className={cn("capsule-card-title", className)} {...props} />;
}

export function CapsuleCardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="capsule-card-description" className={cn("capsule-card-description", className)} {...props} />;
}

export function CapsuleCardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="capsule-card-content" className={cn("capsule-card-content", className)} {...props} />;
}

export function CapsuleCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="capsule-card-footer" className={cn("capsule-card-footer", className)} {...props} />;
}
