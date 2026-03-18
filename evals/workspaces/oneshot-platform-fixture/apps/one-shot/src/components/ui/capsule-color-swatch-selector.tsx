import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";

function CapsuleColorSwatchSelectorRoot({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="capsule-color-swatch-selector-root"
      className={cn("capsule-swatch-root", className)}
      {...props}
    />
  );
}

function CapsuleColorSwatchSelectorLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="capsule-color-swatch-selector-label"
      className={cn("capsule-swatch-label", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function CapsuleColorSwatchSelectorContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="capsule-color-swatch-selector-content"
      className={cn("capsule-swatch-content", className)}
      {...props}
    />
  );
}

type CapsuleColorSwatchSelectorItemProps = React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  swatch: string;
  label?: string;
};

function CapsuleColorSwatchSelectorItem({
  className,
  swatch,
  label,
  ...props
}: CapsuleColorSwatchSelectorItemProps) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="capsule-color-swatch-selector-item"
      className={cn("capsule-swatch-item", className)}
      style={{ backgroundColor: swatch }}
      aria-label={label}
      {...props}
    >
      <span className="capsule-swatch-highlight" aria-hidden="true" />
      <span className="capsule-swatch-center" aria-hidden="true">
        <span className="capsule-swatch-center-ring" />
        <span className="capsule-swatch-center-core" />
      </span>
    </RadioGroupPrimitive.Item>
  );
}

export const CapsuleColorSwatchSelector = {
  Root: CapsuleColorSwatchSelectorRoot,
  Label: CapsuleColorSwatchSelectorLabel,
  Content: CapsuleColorSwatchSelectorContent,
  Item: CapsuleColorSwatchSelectorItem,
};
