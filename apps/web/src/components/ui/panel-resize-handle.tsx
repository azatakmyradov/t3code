import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface PanelResizeHandleProps {
  readonly handlers: ResizableWidthHandlers;
  readonly edge: "left" | "right";
  readonly label: string;
  readonly className?: string | undefined;
}

export function PanelResizeHandle({ handlers, edge, label, className }: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      className={cn(
        "group absolute inset-y-0 z-20 w-2 touch-none cursor-col-resize select-none",
        edge === "left" ? "-left-1" : "-right-1",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
      />
    </div>
  );
}
