import { describe, expect, it } from "vite-plus/test";

import {
  collectReviewDiffHunkAnchors,
  selectReviewDiffHunkTarget,
} from "./reviewDiffHunkNavigation";

const STICKY_OFFSET_PX = 36;

interface FakeDiffFile {
  readonly path: string;
  readonly top: number;
  readonly separatorTops?: ReadonlyArray<number>;
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly dataset: { reviewDiffFilePath?: string; separatorWrapper?: string } = {};
  className = "";

  constructor(readonly top: number) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: this.top,
      height: 0,
      left: 0,
      right: 0,
      top: this.top,
      width: 0,
      x: 0,
      y: this.top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  querySelectorAll<T extends Element = Element>(selector: string): T[] {
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (child.matches(selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches as unknown as T[];
  }

  private matches(selector: string): boolean {
    if (selector === ".diff-render-file[data-review-diff-file-path]") {
      return (
        this.className.split(/\s+/).includes("diff-render-file") &&
        this.dataset.reviewDiffFilePath !== undefined
      );
    }
    if (selector === "[data-separator-wrapper]") {
      return this.dataset.separatorWrapper !== undefined;
    }
    throw new Error(`Unsupported selector in fake DOM: ${selector}`);
  }
}

function makeContainer(files: ReadonlyArray<FakeDiffFile>): HTMLElement {
  const container = new FakeElement(0);
  for (const file of files) {
    const fileWrapper = new FakeElement(file.top);
    fileWrapper.className = "diff-render-file";
    fileWrapper.dataset.reviewDiffFilePath = file.path;

    for (const top of file.separatorTops ?? []) {
      const separator = new FakeElement(top);
      separator.dataset.separatorWrapper = "true";
      fileWrapper.appendChild(separator);
    }

    container.appendChild(fileWrapper);
  }
  return container as unknown as HTMLElement;
}

describe("collectReviewDiffHunkAnchors", () => {
  it("keeps duplicate basenames distinct by full path", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        { path: "src/server.rs", top: 0, separatorTops: [80, 160] },
        { path: "x3-mcp/src/server.rs", top: 260, separatorTops: [320, 380] },
      ]),
    );

    expect(anchors.map((anchor) => `${anchor.kind}:${anchor.filePath}:${anchor.top}`)).toEqual([
      "file:src/server.rs:0",
      "hunk:src/server.rs:80",
      "hunk:src/server.rs:160",
      "file:x3-mcp/src/server.rs:260",
      "hunk:x3-mcp/src/server.rs:320",
      "hunk:x3-mcp/src/server.rs:380",
    ]);
  });

  it("dedupes split-view separator elements at the same visual row", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        {
          path: "src/server.rs",
          top: 0,
          separatorTops: [80, 82, 160, 164, 240],
        },
      ]),
    );

    expect(anchors.filter((anchor) => anchor.kind === "hunk").map((anchor) => anchor.top)).toEqual([
      80, 160, 240,
    ]);
  });

  it("keeps collapsed file wrappers as file anchors", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        { path: "src/server.rs", top: 0, separatorTops: [80] },
        { path: "x3-mcp/src/server.rs", top: 160 },
      ]),
    );

    expect(anchors.at(-1)).toMatchObject({
      filePath: "x3-mcp/src/server.rs",
      kind: "file",
      top: 160,
    });
  });
});

describe("selectReviewDiffHunkTarget", () => {
  it("moves to the upper duplicate-basename file when going previous from the lower file", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        { path: "src/server.rs", top: -260, separatorTops: [-180, -100] },
        { path: "x3-mcp/src/server.rs", top: STICKY_OFFSET_PX, separatorTops: [96] },
      ]),
    );

    expect(selectReviewDiffHunkTarget(anchors, -1, STICKY_OFFSET_PX)).toMatchObject({
      filePath: "src/server.rs",
      kind: "hunk",
      top: -100,
    });
  });

  it("advances across duplicate basenames in DOM order", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        { path: "src/server.rs", top: -160, separatorTops: [-80, STICKY_OFFSET_PX] },
        { path: "x3-mcp/src/server.rs", top: 136, separatorTops: [196] },
      ]),
    );

    expect(selectReviewDiffHunkTarget(anchors, 1, STICKY_OFFSET_PX)).toMatchObject({
      filePath: "x3-mcp/src/server.rs",
      kind: "file",
      top: 136,
    });
  });

  it("clamps first and last hunk navigation without overscroll", () => {
    const atTop = collectReviewDiffHunkAnchors(
      makeContainer([{ path: "src/server.rs", top: 0, separatorTops: [80] }]),
    );
    expect(selectReviewDiffHunkTarget(atTop, -1, STICKY_OFFSET_PX)).toMatchObject({
      filePath: "src/server.rs",
      kind: "file",
      top: 0,
    });

    const atBottom = collectReviewDiffHunkAnchors(
      makeContainer([{ path: "src/server.rs", top: -80, separatorTops: [STICKY_OFFSET_PX] }]),
    );
    expect(selectReviewDiffHunkTarget(atBottom, 1, STICKY_OFFSET_PX)).toMatchObject({
      filePath: "src/server.rs",
      kind: "hunk",
      top: STICKY_OFFSET_PX,
    });
  });

  it("can navigate to collapsed file anchors", () => {
    const anchors = collectReviewDiffHunkAnchors(
      makeContainer([
        { path: "src/server.rs", top: 0 },
        { path: "x3-mcp/src/server.rs", top: 120 },
      ]),
    );

    expect(selectReviewDiffHunkTarget(anchors, 1, STICKY_OFFSET_PX)).toMatchObject({
      filePath: "x3-mcp/src/server.rs",
      kind: "file",
      top: 120,
    });
  });
});
