import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageContentContainerProps = {
  children: ReactNode;
  className?: string;
};

export function PageContentContainer({
  children,
  className,
}: PageContentContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-auto pb-4 pt-2 sm:pt-3 px-1",
        className,
      )}
    >
      {children}
    </div>
  );
}
