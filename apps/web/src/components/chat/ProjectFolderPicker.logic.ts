import { fileBasename } from "@t3tools/shared/path";

/** Keep folder names short, adding parent segments when names collide. */
export function buildProjectFolderLabels(paths: ReadonlyArray<string>) {
  const entries = paths.map((path) => {
    const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
    return { path, normalized, segments: normalized.split("/").filter(Boolean) };
  });
  const byName = new Map<string, typeof entries>();
  for (const entry of entries) {
    const name = fileBasename(entry.path);
    const group = byName.get(name) ?? [];
    group.push(entry);
    byName.set(name, group);
  }
  const labels = new Map<string, string>();
  for (const group of byName.values()) {
    for (const entry of group) {
      let depth = 1;
      while (
        depth < entry.segments.length &&
        group.some(
          (other) =>
            other.normalized !== entry.normalized &&
            other.segments.slice(-depth).join("/") === entry.segments.slice(-depth).join("/"),
        )
      ) {
        depth += 1;
      }
      labels.set(entry.path, entry.segments.slice(-depth).join("/") || fileBasename(entry.path));
    }
  }
  return labels;
}
