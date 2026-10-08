import { describe, expect, it } from "vite-plus/test";
import { buildProjectFolderLabels } from "./ProjectFolderPicker.logic";

describe("buildProjectFolderLabels", () => {
  it("shows only folder names when they are distinct", () => {
    const paths = ["/work/t3code", "/work/t3code/apps/server", "/work/t3code/apps/web"];
    expect([...buildProjectFolderLabels(paths).values()]).toEqual(["t3code", "server", "web"]);
  });

  it("adds only enough parent context to distinguish repeated names", () => {
    const paths = ["/work/apps/server", "/work/tools/server", "/work/web"];
    expect([...buildProjectFolderLabels(paths).values()]).toEqual([
      "apps/server",
      "tools/server",
      "web",
    ]);
  });

  it("handles repeated parent names and a folder that is another path's suffix", () => {
    const paths = ["/a/apps/server", "/b/apps/server", "/server"];
    expect([...buildProjectFolderLabels(paths).values()]).toEqual([
      "a/apps/server",
      "b/apps/server",
      "server",
    ]);
  });

  it("handles Windows folders on different drives", () => {
    const paths = ["C:\\work\\server", "D:\\work\\server", "C:\\work\\web\\"];
    expect([...buildProjectFolderLabels(paths).values()]).toEqual([
      "C:/work/server",
      "D:/work/server",
      "web",
    ]);
  });

  it("does not treat the selected path or trailing separators as another folder", () => {
    const paths = ["/work/server", "/work/server/", "/work/server"];
    expect([...buildProjectFolderLabels(paths).values()]).toEqual(["server", "server"]);
  });

  it("keeps filesystem roots visible", () => {
    expect([...buildProjectFolderLabels(["/", "C:\\"]).values()]).toEqual(["/", "C:"]);
  });
});
