import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 [&_svg]:block outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        emphasis:
          "bg-emphasis text-emphasis-foreground hover:bg-emphasis/85 hover:text-emphasis-foreground",
        capsule:
          "border border-[rgba(228,224,219,0.8)] bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(246,244,241,0.94)_100%)] text-[var(--capsule-text)] shadow-[0_8px_18px_rgba(70,58,46,0.08),0_1px_0_rgba(255,255,255,0.75),inset_0_1px_0_rgba(255,255,255,0.92)] hover:bg-[linear-gradient(160deg,rgba(255,255,255,1)_0%,rgba(248,246,243,0.96)_100%)] hover:text-[var(--capsule-text)]",
        "capsule-accent":
          "border border-transparent bg-[linear-gradient(148deg,rgba(255,255,255,0.26)_0%,rgba(255,255,255,0.12)_20%,rgba(255,255,255,0)_42%),linear-gradient(330deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0)_34%),var(--capsule-button-accent,var(--capsule-accent-strong))] text-white shadow-[0_12px_22px_rgba(70,58,46,0.1),inset_1px_3px_6px_rgba(0,0,0,0.14),inset_-1px_-1px_0_rgba(255,255,255,0.08)] hover:brightness-[1.02] hover:text-white",
        "capsule-ghost":
          "border border-[var(--capsule-stroke)] bg-[linear-gradient(148deg,rgba(255,255,255,0.2)_0%,rgba(255,255,255,0.08)_18%,rgba(255,255,255,0)_40%),var(--capsule-shell)] text-[var(--capsule-muted-text)] shadow-[var(--capsule-shadow-recessed)] hover:bg-[linear-gradient(148deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.1)_18%,rgba(255,255,255,0)_40%),var(--capsule-shell-hover)] hover:text-[var(--capsule-text)]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        capsule: "h-11 rounded-[999px] px-5 text-[13px] font-semibold tracking-[-0.01em]",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = variant?.startsWith("capsule") ? "capsule" : "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
