export interface ReviewDiffHunkAnchor {
  readonly id: string;
  readonly filePath: string;
  readonly kind: "file" | "hunk";
  readonly top: number;
}

const REVIEW_DIFF_FILE_SELECTOR = ".diff-render-file[data-review-diff-file-path]";
const HUNK_SEPARATOR_SELECTOR = "[data-separator-wrapper]";
const HUNK_ANCHOR_DEDUPE_PX = 4;
const CURRENT_ANCHOR_TOLERANCE_PX = 2;

function getViewportRelativeTop(containerTop: number, element: HTMLElement): number {
  return Math.round(element.getBoundingClientRect().top - containerTop);
}

function collectDedupedSeparatorTops(
  fileWrapper: HTMLElement,
  containerTop: number,
): ReadonlyArray<number> {
  const separatorTops = Array.from(
    fileWrapper.querySelectorAll<HTMLElement>(HUNK_SEPARATOR_SELECTOR),
  )
    .map((element) => getViewportRelativeTop(containerTop, element))
    .toSorted((left, right) => left - right);

  const result: number[] = [];
  for (const top of separatorTops) {
    const previous = result.at(-1);
    if (previous === undefined || top - previous > HUNK_ANCHOR_DEDUPE_PX) {
      result.push(top);
    }
  }
  return result;
}

export function collectReviewDiffHunkAnchors(container: HTMLElement): ReviewDiffHunkAnchor[] {
  const containerTop = container.getBoundingClientRect().top;
  const anchors: ReviewDiffHunkAnchor[] = [];
  const fileWrappers = Array.from(
    container.querySelectorAll<HTMLElement>(REVIEW_DIFF_FILE_SELECTOR),
  );

  for (const fileWrapper of fileWrappers) {
    const filePath = fileWrapper.dataset.reviewDiffFilePath;
    if (!filePath) continue;

    anchors.push({
      id: `file:${filePath}`,
      filePath,
      kind: "file",
      top: getViewportRelativeTop(containerTop, fileWrapper),
    });

    const separatorTops = collectDedupedSeparatorTops(fileWrapper, containerTop);
    for (let index = 0; index < separatorTops.length; index += 1) {
      anchors.push({
        id: `hunk:${filePath}:${index}`,
        filePath,
        kind: "hunk",
        top: separatorTops[index]!,
      });
    }
  }

  return anchors;
}

export function selectReviewDiffHunkTarget(
  anchors: readonly ReviewDiffHunkAnchor[],
  direction: 1 | -1,
  stickyOffsetPx: number,
): ReviewDiffHunkAnchor | null {
  if (anchors.length === 0) return null;

  let currentIndex = -1;
  const currentLineTop = stickyOffsetPx + CURRENT_ANCHOR_TOLERANCE_PX;
  for (let index = 0; index < anchors.length; index += 1) {
    if (anchors[index]!.top <= currentLineTop) {
      currentIndex = index;
    } else {
      break;
    }
  }

  const targetIndex =
    direction === 1
      ? Math.min(anchors.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);

  return anchors[targetIndex] ?? null;
}
