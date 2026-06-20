import type { EnvironmentId } from "@t3tools/contracts";
import { FileDiffIcon } from "lucide-react";
import { Suspense, lazy, useState } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const ReviewDiffViewer = lazy(() =>
  import("./ReviewDiffViewer").then((module) => ({ default: module.ReviewDiffViewer })),
);

interface ReviewDiffButtonProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export function ReviewDiffButton({ environmentId, cwd }: ReviewDiffButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              aria-label="Review changes in full-screen diff"
              onClick={() => setOpen(true)}
            >
              <FileDiffIcon className="size-3.5" aria-hidden />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                Review
              </span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">Review changes (full-screen diff)</TooltipPopup>
      </Tooltip>
      {open && (
        <Suspense fallback={null}>
          <ReviewDiffViewer
            environmentId={environmentId}
            cwd={cwd}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
