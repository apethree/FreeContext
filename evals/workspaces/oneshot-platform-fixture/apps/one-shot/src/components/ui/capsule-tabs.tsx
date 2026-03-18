import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function CapsuleTabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="capsule-tabs" className="flex flex-col gap-4" {...props} />;
}

export function CapsuleTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="capsule-tabs-list" className={cn("capsule-tabs-list", className)} {...props} />;
}

export function CapsuleTabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="capsule-tabs-trigger"
      className={cn("capsule-tabs-trigger", className)}
      {...props}
    >
      <span className="capsule-tabs-trigger-content">
        <span className="capsule-tabs-trigger-dot" aria-hidden="true">
          <span className="capsule-tabs-trigger-dot-core" />
        </span>
        <span>{children}</span>
      </span>
    </TabsPrimitive.Trigger>
  );
}

export function CapsuleTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="capsule-tabs-content"
      className={cn("capsule-tabs-content", className)}
      {...props}
    />
  );
}
