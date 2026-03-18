import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type OneShotLogoProps = Omit<ComponentProps<"svg">, "viewBox" | "xmlns">;

export function OneShotLogo({ className, ...props }: OneShotLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-10 w-10 text-black dark:text-white", className)}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="
          M 50,10
          C 28,10 20,22 20,45
          L 20,55
          C 20,78 28,90 50,90
          C 72,90 80,78 80,55
          L 80,45
          C 80,22 72,10 50,10
          Z
          M 50,18
          C 67,18 72,27 72,45
          L 72,55
          C 72,73 67,82 50,82
          C 33,82 28,73 28,55
          L 28,45
          C 28,27 33,18 50,18
          Z"
        fill="currentColor"
      />
      <circle cx="50" cy="50" r="14" fill="#0a66ff" />
      <circle cx="50" cy="50" r="7" fill="#86b8ff" />
    </svg>
  );
}
