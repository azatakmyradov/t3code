import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  THREAD_DETAILS_PANEL_TEXT_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsSection({
  headingId,
  title,
  headingIcon,
  actions,
  separated = true,
  showHeading = true,
  children,
  ...props
}: Omit<ComponentProps<"section">, "className" | "style" | "title" | "aria-labelledby"> & {
  headingId: string;
  title: string;
  headingIcon?: ReactNode;
  actions?: ReactNode;
  separated?: boolean;
  showHeading?: boolean;
}) {
  return (
    <section
      {...props}
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      className={cn("px-2 pt-2 pb-2.5", separated && "border-t border-border/65")}
    >
      <div
        className={cn(
          "flex min-w-0 items-center justify-between",
          headingIcon
            ? cn("h-8", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)
            : "mb-1 min-h-8 gap-2 px-2.5",
          !showHeading && "hidden",
        )}
      >
        {headingIcon}
        <h3
          id={headingId}
          className={cn(
            "min-w-0 flex-1 truncate font-medium select-none",
            headingIcon
              ? cn(THREAD_DETAILS_PANEL_TEXT_CLASS, THREAD_DETAILS_PANEL_LABEL_CLASS)
              : "text-2xs text-muted-foreground",
          )}
        >
          {title}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
