import type * as React from "react";
import { cn } from "@/lib/utils";

export function GraphOverlayContainer({ children, className }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-md border bg-background/95 p-4 shadow-md backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
