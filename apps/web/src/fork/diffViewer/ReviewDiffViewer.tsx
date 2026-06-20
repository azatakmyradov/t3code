import { useAtomValue } from "@effect/atom-react";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ReviewDiffPreviewSource,
  ReviewSemanticGroupsResult,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  FileDiffIcon,
  LayersIcon,
  ListTreeIcon,
  RefreshCwIcon,
  Rows3Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DiffStatLabel, hasNonZeroStat } from "~/components/chat/DiffStatLabel";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  getDiffCollapseIconClassName,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { resolveAppModelSelectionState } from "~/modelSelection";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import { reviewEnvironment } from "~/state/review";
import { primaryServerProvidersAtom } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironmentQuery } from "~/state/query";

import { ReviewDiffFileTree } from "./ReviewDiffFileTree";
import { ReviewDiffGroupsSidebar } from "./ReviewDiffGroupsSidebar";
import {
  buildReviewDiffGroupViews,
  reviewGroupRiskAccentClassName,
  reviewGroupRiskBadgeClassName,
  reviewGroupRiskLabel,
  resolveReviewDiffSidebarMode,
  type ReviewDiffGroupView,
  type ReviewDiffSidebarMode,
} from "./reviewDiffGroupsModel";
import {
  buildReviewSemanticGroupsCacheIdentity,
  buildReviewSemanticGroupsModelSelectionKey,
  readReviewSemanticGroupsCache,
  writeReviewSemanticGroupsCache,
} from "./reviewGroupsCache";
import {
  buildReviewDiffFiles,
  buildReviewDiffTree,
  flattenReviewDiffTreeFiles,
  summarizeReviewDiffStat,
  type ReviewDiffFile,
} from "./reviewDiffModel";
import {
  collectReviewDiffHunkAnchors,
  selectReviewDiffHunkTarget,
} from "./reviewDiffHunkNavigation";
import { reviewGroupsEnvironment } from "./reviewGroupsState";
import { REVIEW_DIFF_UNSAFE_CSS } from "./reviewDiffStyles";

interface ReviewDiffViewerProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly onClose: () => void;
}

// AI grouping is agentic (the agent runs git itself), which only Claude/Codex
// support under their current invocation modes. Mirrors the server-side gate in
// `fork/reviewGroups/rpcHandlers.ts`. Kept as plain strings (driver kinds) to
// avoid a server import from the web bundle.
const GROUPING_SUPPORTED_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);
const GROUPING_UNSUPPORTED_MESSAGE = "AI grouping is only available with Claude or Codex.";

const EMPTY_SOURCES: ReadonlyArray<ReviewDiffPreviewSource> = [];
const EMPTY_FILES: ReadonlyArray<ReviewDiffFile> = [];
const EMPTY_GROUP_VIEWS: ReadonlyArray<ReviewDiffGroupView> = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Return a new Set with `key` toggled (added if absent, removed if present). */
function toggledSet(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

type DiffRenderStyle = "unified" | "split";

/** A row in the diff pane: a file diff, or (in groups mode) a group separator. */
type DiffRenderItem =
  | { readonly kind: "file"; readonly file: ReviewDiffFile }
  | { readonly kind: "group"; readonly group: ReviewDiffGroupView };

interface GeneratedReviewGroupsState {
  readonly requestKey: string;
  readonly result: ReviewSemanticGroupsResult;
}

interface ReviewGroupsErrorState {
  readonly requestKey: string;
  readonly message: string;
}

interface ReviewGroupsSidebarModeState {
  readonly requestKey: string;
  readonly mode: ReviewDiffSidebarMode;
}

interface CollapsedReviewGroupsState {
  readonly requestKey: string;
  readonly groups: ReadonlySet<string>;
}

// Marker class on the Virtualizer's scroll root so we can resolve it for
// scrolling/keyboard handling (the component exposes no ref).
const DIFF_SCROLL_CLASS = "review-diff-scroll";
const DIFF_SCROLL_STEP_PX = 80;
// Review diffs are size-capped by the server, so virtualization isn't needed
// for load — and its windowing left large files dehydrated (rendered as blank
// dark boxes). We keep the Virtualizer (it drives correct on-load syntax
// highlighting) but use huge windows so every file/line stays rendered.
const DIFF_RENDER_ALL_PX = 1_000_000;
// Approximate height of the sticky per-file diff header so hunk jumps land just
// below it instead of behind it.
const HUNK_STICKY_OFFSET_PX = 36;

/** Path of the file currently scrolled to the top of the diff pane. */
function topVisibleFilePath(container: HTMLElement): string | null {
  const fileElements = Array.from(
    container.querySelectorAll<HTMLElement>("[data-review-diff-file-path]"),
  );
  if (fileElements.length === 0) return null;
  const containerTop = container.getBoundingClientRect().top;
  let active = fileElements[0];
  for (const element of fileElements) {
    if (element.getBoundingClientRect().top - containerTop <= 8) {
      active = element;
    } else {
      break;
    }
  }
  return active?.dataset.reviewDiffFilePath ?? null;
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-border/60 bg-muted/40 px-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
        {keys}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

export function ReviewDiffViewer({ environmentId, cwd, onClose }: ReviewDiffViewerProps) {
  const { resolvedTheme } = useTheme();

  const diffQuery = useEnvironmentQuery(
    reviewEnvironment.diffPreview({ environmentId, input: { cwd, sizeProfile: "large" } }),
  );
  const result = diffQuery.data;
  const sources = result?.sources ?? EMPTY_SOURCES;

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const activeSource = useMemo(() => {
    if (sources.length === 0) return null;
    const selected = activeSourceId ? sources.find((source) => source.id === activeSourceId) : null;
    if (selected) return selected;
    return sources.find((source) => source.kind === "working-tree") ?? sources[0] ?? null;
  }, [sources, activeSourceId]);

  const renderable = useMemo(
    () =>
      getRenderablePatch(
        activeSource?.diff,
        `review-diff:${activeSource?.diffHash ?? "none"}:${resolvedTheme}`,
      ),
    [activeSource?.diff, activeSource?.diffHash, resolvedTheme],
  );
  const parsedFiles = useMemo(
    () => (renderable?.kind === "files" ? buildReviewDiffFiles(renderable.files) : EMPTY_FILES),
    [renderable],
  );
  const tree = useMemo(() => buildReviewDiffTree(parsedFiles), [parsedFiles]);
  // Order the diff pane (and file navigation) to match the sidebar's tree order.
  const files = useMemo(() => flattenReviewDiffTreeFiles(tree), [tree]);
  const totals = useMemo(() => summarizeReviewDiffStat(files), [files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffRenderStyle>("unified");
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [reviewedPaths, setReviewedPaths] = useState<ReadonlySet<string>>(EMPTY_SET);

  // AI semantic groups (fork feature): an on-demand grouping of the changed
  // files by concern, risk-sorted. State is keyed by the active source/diff/model
  // so source changes naturally ignore stale generated UI state.
  const [sidebarModeState, setSidebarModeState] = useState<ReviewGroupsSidebarModeState | null>(
    null,
  );
  const [generatedGroupsState, setGeneratedGroupsState] =
    useState<GeneratedReviewGroupsState | null>(null);
  const [groupsErrorState, setGroupsErrorState] = useState<ReviewGroupsErrorState | null>(null);
  const [groupsPending, setGroupsPending] = useState(false);
  const [collapsedGroupsState, setCollapsedGroupsState] =
    useState<CollapsedReviewGroupsState | null>(null);
  const runGroupSemanticDiff = useAtomCommand(reviewGroupsEnvironment.groupSemanticDiff, {
    reportFailure: false,
  });

  // Resolve the driver kind backing the configured review-groups model so the
  // "Group with AI" trigger can be disabled (with an explanation) for providers
  // that cannot run the agentic grouping, instead of failing only on click.
  const settings = useSettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const effectiveReviewGroupsModelSelection = useMemo(() => {
    const override = settings.fork.reviewGroupsModelSelection;
    return resolveAppModelSelectionState(
      override ? { ...settings, textGenerationModelSelection: override } : settings,
      serverProviders,
    );
  }, [settings, serverProviders]);
  const reviewGroupsModelSelectionKey = buildReviewSemanticGroupsModelSelectionKey(
    effectiveReviewGroupsModelSelection,
  );
  const groupingSupported = useMemo(() => {
    const driverKind = deriveProviderInstanceEntries(serverProviders).find(
      (entry) => entry.instanceId === effectiveReviewGroupsModelSelection.instanceId,
    )?.driverKind;
    return driverKind ? GROUPING_SUPPORTED_DRIVERS.has(driverKind) : false;
  }, [effectiveReviewGroupsModelSelection.instanceId, serverProviders]);
  const reviewGroupsCacheIdentity = useMemo(
    () =>
      buildReviewSemanticGroupsCacheIdentity({
        environmentId,
        cwd,
        source: activeSource,
        modelSelectionKey: reviewGroupsModelSelectionKey,
      }),
    [environmentId, cwd, activeSource, reviewGroupsModelSelectionKey],
  );
  const activeGroupingRequestKey = useMemo(
    () =>
      JSON.stringify([
        environmentId,
        cwd,
        activeSource?.id ?? null,
        activeSource?.diffHash ?? null,
        reviewGroupsModelSelectionKey,
      ]),
    [environmentId, cwd, activeSource?.id, activeSource?.diffHash, reviewGroupsModelSelectionKey],
  );
  const cachedGroupsResult = useMemo(
    () =>
      readReviewSemanticGroupsCache(reviewGroupsCacheIdentity, {
        updateLastAccess: false,
      }),
    [reviewGroupsCacheIdentity],
  );
  useEffect(() => {
    if (!cachedGroupsResult) return;
    readReviewSemanticGroupsCache(reviewGroupsCacheIdentity);
  }, [cachedGroupsResult, reviewGroupsCacheIdentity]);
  const generatedGroupsResult =
    generatedGroupsState?.requestKey === activeGroupingRequestKey
      ? generatedGroupsState.result
      : null;
  const groupsResult = generatedGroupsResult ?? cachedGroupsResult;
  const groupsError =
    groupsErrorState?.requestKey === activeGroupingRequestKey ? groupsErrorState.message : null;
  const sidebarMode = resolveReviewDiffSidebarMode({
    overrideMode:
      sidebarModeState?.requestKey === activeGroupingRequestKey ? sidebarModeState.mode : null,
    hasGroups: groupsResult !== null,
    defaultMode: settings.fork.reviewGroupsDefaultMode,
  });
  const collapsedGroups =
    collapsedGroupsState?.requestKey === activeGroupingRequestKey
      ? collapsedGroupsState.groups
      : EMPTY_SET;

  const groupViews = useMemo(
    () =>
      groupsResult ? buildReviewDiffGroupViews(groupsResult.groups, files) : EMPTY_GROUP_VIEWS,
    [groupsResult, files],
  );
  const inGroupsMode = sidebarMode === "groups" && groupsResult !== null;
  // Diff pane / navigation order: group order (critical first) when grouping is
  // active, otherwise the sidebar tree order.
  const diffFiles = useMemo(
    () => (inGroupsMode ? groupViews.flatMap((group) => group.files) : files),
    [inGroupsMode, groupViews, files],
  );
  const nextSelectedPath =
    diffFiles.length === 0
      ? null
      : selectedPath && diffFiles.some((file) => file.path === selectedPath)
        ? selectedPath
        : (diffFiles[0]?.path ?? null);
  if (selectedPath !== nextSelectedPath) {
    setSelectedPath(nextSelectedPath);
  }
  const resolvedSelectedPath = nextSelectedPath;
  const renderItems = useMemo<DiffRenderItem[]>(() => {
    if (!inGroupsMode) {
      return diffFiles.map((file) => ({ kind: "file", file }));
    }
    const items: DiffRenderItem[] = [];
    for (const group of groupViews) {
      items.push({ kind: "group", group });
      for (const file of group.files) {
        items.push({ kind: "file", file });
      }
    }
    return items;
  }, [inGroupsMode, diffFiles, groupViews]);

  const rootRef = useRef<HTMLDivElement>(null);
  const diffPaneRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Tracks a pending `g` for the vim-style `gg` (jump to top) sequence.
  const pendingGRef = useRef(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The actual scroll element is the Virtualizer's root, which we can only tag
  // via className (it exposes no ref).
  const getScrollEl = useCallback(
    (): HTMLElement | null =>
      diffPaneRef.current?.querySelector<HTMLElement>(`.${DIFF_SCROLL_CLASS}`) ?? null,
    [],
  );

  // Stable mirrors so the global key handler stays referentially stable.
  // Tracks the displayed order (group order when grouping is active).
  const filesRef = useRef(diffFiles);
  const selectedPathRef = useRef(resolvedSelectedPath);
  const sourcesRef = useRef(sources);
  // Tracks the active source id so an in-flight grouping request can detect a
  // source switch / refresh that happened while it was awaiting.
  const activeSourceIdRef = useRef<string | null>(activeSource?.id ?? null);
  const activeGroupingRequestKeyRef = useRef<string | null>(activeGroupingRequestKey);

  useLayoutEffect(() => {
    filesRef.current = diffFiles;
    selectedPathRef.current = resolvedSelectedPath;
    sourcesRef.current = sources;
    activeSourceIdRef.current = activeSource?.id ?? null;
    activeGroupingRequestKeyRef.current = activeGroupingRequestKey;
  });

  // Set the active file and scroll its diff to the top of the viewport.
  const scrollToFile = useCallback((path: string) => {
    setSelectedPath(path);
    diffPaneRef.current
      ?.querySelector<HTMLElement>(`[data-review-diff-file-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: "start" });
  }, []);

  const goToFileByOffset = useCallback(
    (offset: 1 | -1) => {
      const list = filesRef.current;
      if (list.length === 0) return;
      const index = list.findIndex((file) => file.path === selectedPathRef.current);
      const base = index < 0 ? 0 : index;
      const next = Math.min(list.length - 1, Math.max(0, base + offset));
      const path = list[next]?.path;
      if (path) scrollToFile(path);
    },
    [scrollToFile],
  );

  // Scroll the diff pane by a fixed step (line-style scrolling with j/k).
  const scrollDiffBy = useCallback(
    (delta: number) => {
      getScrollEl()?.scrollBy({ top: delta });
    },
    [getScrollEl],
  );

  // Jump to the very top (`gg`) or bottom (`G`) of the diff pane.
  const scrollDiffToEdge = useCallback(
    (edge: "top" | "bottom") => {
      const container = getScrollEl();
      if (!container) return;
      container.scrollTo({ top: edge === "top" ? 0 : container.scrollHeight });
    },
    [getScrollEl],
  );

  // Jump to the previous/next hunk boundary. Indexing off the anchor we are
  // currently parked at (the last one at/above the sticky line) avoids the
  // threshold dead-zone / re-targeting that comparing raw positions caused.
  // Works off viewport-relative positions + a relative scroll so sticky headers
  // don't skew the math; the target lands just below the sticky header.
  const jumpHunk = useCallback(
    (direction: 1 | -1) => {
      const container = getScrollEl();
      if (!container) return;
      const anchors = collectReviewDiffHunkAnchors(container);
      const target = selectReviewDiffHunkTarget(anchors, direction, HUNK_STICKY_OFFSET_PX);
      if (!target) return;
      setSelectedPath(target.filePath);
      container.scrollBy({ top: target.top - HUNK_STICKY_OFFSET_PX });
    },
    [getScrollEl],
  );

  const toggleDiffStyle = useCallback(() => {
    setDiffStyle((current) => (current === "unified" ? "split" : "unified"));
  }, []);

  const toggleReviewedPath = useCallback((path: string) => {
    setReviewedPaths((current) => toggledSet(current, path));
  }, []);

  // Mark the file currently in view (computed synchronously so a fast `m` after
  // a scroll/jump can't race the scroll-sync rAF and hit a stale selection).
  const toggleSelectedReviewed = useCallback(() => {
    const container = getScrollEl();
    const path = (container && topVisibleFilePath(container)) ?? selectedPathRef.current;
    if (!path) return;
    toggleReviewedPath(path);
    setSelectedPath(path);
  }, [getScrollEl, toggleReviewedPath]);

  const cycleSource = useCallback(() => {
    const list = sourcesRef.current;
    if (list.length <= 1) return;
    setActiveSourceId((current) => {
      const activeIndex = list.findIndex((source) => source.id === current);
      const base =
        activeIndex < 0 ? list.findIndex((source) => source.kind === "working-tree") : activeIndex;
      const next = list[((base < 0 ? 0 : base) + 1) % list.length];
      return next?.id ?? current;
    });
  }, []);

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedDirectories((current) => toggledSet(current, path));
  }, []);

  const toggleFileCollapsed = useCallback((renderKey: string) => {
    setCollapsedFiles((current) => toggledSet(current, renderKey));
  }, []);

  const toggleGroup = useCallback(
    (id: string) => {
      setCollapsedGroupsState((current) => {
        const currentGroups =
          current?.requestKey === activeGroupingRequestKey ? current.groups : EMPTY_SET;
        return {
          requestKey: activeGroupingRequestKey,
          groups: toggledSet(currentGroups, id),
        };
      });
    },
    [activeGroupingRequestKey],
  );

  // Run the AI semantic grouping for the active diff source on demand.
  const generateGroups = useCallback(async () => {
    if (groupsPending || !groupingSupported) return;
    const forSourceId = activeSource?.id ?? null;
    const forGroupingRequestKey = activeGroupingRequestKey;
    const forCacheIdentity = reviewGroupsCacheIdentity;
    setGroupsPending(true);
    setGroupsErrorState(null);
    const result = await runGroupSemanticDiff({
      environmentId,
      input: { cwd, ...(activeSource ? { sourceId: activeSource.id } : {}) },
    });
    setGroupsPending(false);
    // Discard a stale response: the user switched source / refreshed (which
    // already reset groups) while this request was in flight.
    if (
      activeSourceIdRef.current !== forSourceId ||
      activeGroupingRequestKeyRef.current !== forGroupingRequestKey
    ) {
      return;
    }
    if (result._tag === "Success") {
      writeReviewSemanticGroupsCache(forCacheIdentity, result.value);
      setGeneratedGroupsState({ requestKey: forGroupingRequestKey, result: result.value });
      setCollapsedGroupsState({ requestKey: forGroupingRequestKey, groups: EMPTY_SET });
      setSidebarModeState({ requestKey: forGroupingRequestKey, mode: "groups" });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setGroupsErrorState({
      requestKey: forGroupingRequestKey,
      message: error instanceof Error ? error.message : "Failed to group changes.",
    });
  }, [
    groupsPending,
    groupingSupported,
    runGroupSemanticDiff,
    environmentId,
    cwd,
    activeSource,
    activeGroupingRequestKey,
    reviewGroupsCacheIdentity,
  ]);

  // Move focus into the viewer on open (so keyboard navigation works
  // immediately and keys do not reach the composer behind the overlay) and
  // restore it on close. Background scroll is already locked globally via the
  // `body { overflow: hidden }` rule in index.css, so no scroll lock is needed.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Clear any pending `gg` timeout on unmount.
  useEffect(
    () => () => {
      if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
    },
    [],
  );

  // Keyboard navigation. Capture phase so Escape reliably closes the viewer and
  // Tab stays trapped within the modal.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Tab") {
        const root = rootRef.current;
        if (!root) return;
        const focusables = getFocusableElements(root);
        const active = document.activeElement as HTMLElement | null;
        if (focusables.length === 0) {
          event.preventDefault();
          root.focus();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const outside = !active || !root.contains(active) || active === root;
        if (event.shiftKey && (outside || active === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (outside || active === last)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditable =
        !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
      if (isEditable && event.key !== "Escape") return;

      // Any non-`g` key cancels a pending `gg` sequence.
      if (event.key !== "g") {
        pendingGRef.current = false;
        if (gTimeoutRef.current) {
          clearTimeout(gTimeoutRef.current);
          gTimeoutRef.current = undefined;
        }
      }

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onClose();
          break;
        case "ArrowDown":
        case "j":
          event.preventDefault();
          scrollDiffBy(DIFF_SCROLL_STEP_PX);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          scrollDiffBy(-DIFF_SCROLL_STEP_PX);
          break;
        case "n":
          event.preventDefault();
          goToFileByOffset(1);
          break;
        case "p":
          event.preventDefault();
          goToFileByOffset(-1);
          break;
        case "]":
          event.preventDefault();
          jumpHunk(1);
          break;
        case "[":
          event.preventDefault();
          jumpHunk(-1);
          break;
        case "m":
          event.preventDefault();
          toggleSelectedReviewed();
          break;
        case "v":
          event.preventDefault();
          toggleDiffStyle();
          break;
        case "d":
          event.preventDefault();
          cycleSource();
          break;
        case "g":
          event.preventDefault();
          if (pendingGRef.current) {
            pendingGRef.current = false;
            if (gTimeoutRef.current) {
              clearTimeout(gTimeoutRef.current);
              gTimeoutRef.current = undefined;
            }
            scrollDiffToEdge("top");
          } else {
            pendingGRef.current = true;
            gTimeoutRef.current = setTimeout(() => {
              pendingGRef.current = false;
              gTimeoutRef.current = undefined;
            }, 600);
          }
          break;
        case "G":
          event.preventDefault();
          scrollDiffToEdge("bottom");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    onClose,
    scrollDiffBy,
    scrollDiffToEdge,
    goToFileByOffset,
    jumpHunk,
    toggleSelectedReviewed,
    toggleDiffStyle,
    cycleSource,
  ]);

  // Highlight the file currently scrolled to the top of the diff pane, so the
  // sidebar selection (and `m` / `v` targets) follow scrolling without a click.
  useEffect(() => {
    const container = getScrollEl();
    if (!container) return;
    let frame = 0;
    const syncActiveFile = () => {
      frame = 0;
      const path = topVisibleFilePath(container);
      if (path) {
        setSelectedPath((current) => (current === path ? current : path));
        treeScrollRef.current
          ?.querySelector(`[data-review-diff-tree-path="${CSS.escape(path)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(syncActiveFile);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [diffFiles, getScrollEl]);

  // Reset the diff scroll position when switching diff source.
  useEffect(() => {
    getScrollEl()?.scrollTo({ top: 0 });
  }, [activeSource?.id, getScrollEl]);

  const themeName = resolveDiffThemeName(resolvedTheme);
  const isInitialLoading = diffQuery.isPending && !result;
  const reviewedCount = reviewedPaths.size;

  let body: React.ReactNode;
  if (isInitialLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Loading working tree diff…
      </div>
    );
  } else if (diffQuery.error) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive">{diffQuery.error}</p>
        <Button variant="outline" size="sm" onClick={diffQuery.refresh}>
          Try again
        </Button>
      </div>
    );
  } else if (files.length === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {renderable?.kind === "raw" ? (
          <pre className="max-h-full max-w-full overflow-auto rounded-md border border-border/60 bg-card/40 p-4 text-left font-mono text-xs">
            {renderable.text}
          </pre>
        ) : activeSource ? (
          `No changes in ${activeSource.title}.`
        ) : (
          "No changes to review."
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        <aside
          ref={treeScrollRef}
          className="w-72 shrink-0 overflow-auto border-r border-border bg-card/30"
          aria-label={inGroupsMode ? "Semantic change groups" : "Changed files"}
        >
          {inGroupsMode ? (
            <ReviewDiffGroupsSidebar
              groups={groupViews}
              selectedPath={resolvedSelectedPath}
              reviewedPaths={reviewedPaths}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              onSelectFile={scrollToFile}
            />
          ) : (
            <ReviewDiffFileTree
              nodes={tree}
              selectedPath={resolvedSelectedPath}
              collapsedDirectories={collapsedDirectories}
              reviewedPaths={reviewedPaths}
              onSelectFile={scrollToFile}
              onToggleDirectory={toggleDirectory}
            />
          )}
        </aside>
        <div ref={diffPaneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeSource?.truncated && (
            <p
              role="alert"
              className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
            >
              This diff was truncated because it exceeded the preview size limit. Some changes are
              not shown.
            </p>
          )}
          {/* The Virtualizer needs a stable, definite-height scroll root, so it
              is nested in an overflow-hidden flex child and sized with h-full
              (matching the base DiffPanel). Putting flex-1 directly on the
              Virtualizer mis-measures its viewport and leaves files dehydrated. */}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Virtualizer
              className={cn(DIFF_SCROLL_CLASS, "h-full min-h-0 overflow-auto px-3 pb-3")}
              config={{
                overscrollSize: DIFF_RENDER_ALL_PX,
                intersectionObserverMargin: DIFF_RENDER_ALL_PX,
              }}
            >
              {renderItems.map((item) => {
                if (item.kind === "group") {
                  const group = item.group;
                  return (
                    <div
                      key={`group:${group.id}`}
                      className="mt-4 mb-1 flex items-center gap-2 px-1 first:mt-2"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-3.5 w-1 rounded-full",
                          reviewGroupRiskAccentClassName(group.riskLevel),
                        )}
                      />
                      <span className="text-xs font-semibold text-foreground">{group.title}</span>
                      {!group.isFallback && (
                        <span
                          className={cn(
                            "rounded border px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide tabular-nums",
                            reviewGroupRiskBadgeClassName(group.riskLevel),
                          )}
                        >
                          {reviewGroupRiskLabel(group.riskLevel)} · {group.risk}
                        </span>
                      )}
                      <span className="tabular-nums text-[10px] text-muted-foreground">
                        {group.files.length} {group.files.length === 1 ? "file" : "files"}
                      </span>
                    </div>
                  );
                }
                const file = item.file;
                const collapsed = collapsedFiles.has(file.renderKey);
                return (
                  <div
                    key={`${file.renderKey}:${resolvedTheme}`}
                    data-review-diff-file-path={file.path}
                    className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                  >
                    <FileDiff
                      fileDiff={file.fileDiff}
                      renderHeaderPrefix={() => (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors hover:bg-foreground/10",
                            getDiffCollapseIconClassName(file.fileDiff),
                          )}
                          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
                          aria-expanded={!collapsed}
                          onClick={() => toggleFileCollapsed(file.renderKey)}
                        >
                          {collapsed ? (
                            <ChevronRightIcon className="size-4" />
                          ) : (
                            <ChevronDownIcon className="size-4" />
                          )}
                        </button>
                      )}
                      options={{
                        collapsed,
                        diffStyle,
                        lineDiffType: "none",
                        overflow: "scroll",
                        theme: themeName,
                        themeType: resolvedTheme,
                        unsafeCSS: REVIEW_DIFF_UNSAFE_CSS,
                      }}
                    />
                  </div>
                );
              })}
            </Virtualizer>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-slot="dialog"
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none [-webkit-app-region:no-drag]"
      role="dialog"
      aria-modal="true"
      aria-label="Review diff viewer"
    >
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-3 border-b border-border px-4",
          // Reserve space for the native macOS traffic lights so they don't overlap the title.
          isElectron && "pl-[90px] wco:pl-[calc(env(titlebar-area-x)+1em)]",
        )}
      >
        <FileDiffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">Diff</span>
          {activeSource && (
            <span className="text-sm text-muted-foreground">{activeSource.title}</span>
          )}
        </div>
        {sources.length > 1 && (
          <ToggleGroup
            className="ml-1"
            variant="outline"
            size="xs"
            value={activeSource ? [activeSource.id] : []}
            onValueChange={(value) => {
              const next = value[0];
              if (next) setActiveSourceId(next);
            }}
          >
            {sources.map((source) => (
              <Toggle key={source.id} value={source.id} aria-label={`Show ${source.title} diff`}>
                <span className="px-0.5 text-[11px]">{source.title}</span>
              </Toggle>
            ))}
          </ToggleGroup>
        )}
        <ToggleGroup
          className="ml-1"
          variant="outline"
          size="xs"
          value={[diffStyle]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "unified" || next === "split") setDiffStyle(next);
          }}
        >
          <Toggle value="unified" aria-label="Unified view (v)">
            <Rows3Icon className="size-3" />
          </Toggle>
          <Toggle value="split" aria-label="Split view (v)">
            <Columns2Icon className="size-3" />
          </Toggle>
        </ToggleGroup>
        {files.length > 0 && (
          <div className="ml-1 flex items-center gap-1">
            {groupsResult && (
              <ToggleGroup
                variant="outline"
                size="xs"
                value={[sidebarMode]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "files" || next === "groups") {
                    setSidebarModeState({ requestKey: activeGroupingRequestKey, mode: next });
                  }
                }}
              >
                <Toggle value="files" aria-label="Show file tree">
                  <ListTreeIcon className="size-3" />
                </Toggle>
                <Toggle value="groups" aria-label="Show AI semantic groups">
                  <LayersIcon className="size-3" />
                </Toggle>
              </ToggleGroup>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={groupsResult ? "Regroup changes with AI" : "Group changes with AI"}
                    disabled={groupsPending || !groupingSupported}
                    onClick={() => void generateGroups()}
                  >
                    {groupsPending ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <SparklesIcon className="size-3.5" />
                    )}
                    <span className="px-0.5 text-[11px]">
                      {groupsPending ? "Grouping…" : groupsResult ? "Regroup" : "Group with AI"}
                    </span>
                  </Button>
                }
              />
              <TooltipPopup side="bottom">
                {!groupingSupported
                  ? GROUPING_UNSUPPORTED_MESSAGE
                  : groupsResult
                    ? "Re-run AI semantic grouping"
                    : "Group changes by concern with AI, most critical first"}
              </TooltipPopup>
            </Tooltip>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {activeSource?.truncated && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    Truncated
                  </span>
                }
              />
              <TooltipPopup side="bottom">
                This diff exceeded the preview size limit; some changes are not shown.
              </TooltipPopup>
            </Tooltip>
          )}
          <span className="tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
          {hasNonZeroStat(totals) && (
            <DiffStatLabel
              additions={totals.additions}
              deletions={totals.deletions}
              layout="inline"
            />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh diff"
                  disabled={diffQuery.isPending}
                  onClick={diffQuery.refresh}
                />
              }
            >
              <RefreshCwIcon className={cn("size-3.5", diffQuery.isPending && "animate-spin")} />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Refresh</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close diff viewer"
                  onClick={onClose}
                />
              }
            >
              <XIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Close (Esc)</TooltipPopup>
          </Tooltip>
        </div>
      </header>

      {groupsError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
        >
          <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">AI grouping failed: {groupsError}</span>
          <button
            type="button"
            className="shrink-0 rounded px-1 font-medium hover:bg-destructive/10"
            onClick={() => setGroupsErrorState(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {body}

      <footer className="flex h-8 shrink-0 items-center gap-4 overflow-x-auto border-t border-border px-4 text-[11px] text-muted-foreground/80">
        <KeyHint keys="j k ↑ ↓" label="scroll" />
        <KeyHint keys="gg G" label="top / bottom" />
        <KeyHint keys="n p" label="next / prev file" />
        <KeyHint keys="[ ]" label="prev / next hunk" />
        <KeyHint keys="v" label="split view" />
        <KeyHint keys="m" label="mark reviewed" />
        {sources.length > 1 && <KeyHint keys="d" label="switch source" />}
        <KeyHint keys="esc" label="close" />
        {files.length > 0 && (
          <span
            role="status"
            aria-label={`${reviewedCount} of ${files.length} files marked reviewed`}
            className="ml-auto shrink-0 tabular-nums"
          >
            {reviewedCount}/{files.length} reviewed
          </span>
        )}
      </footer>
    </div>
  );
}

export default ReviewDiffViewer;
