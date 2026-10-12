import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { guideProgressKey, guideRunKey, useGuideRunStore } from "./guideRunStore";

describe("account-scoped guide runs", () => {
  beforeEach(() =>
    useGuideRunStore.setState({ watches: {}, progress: {}, shownKey: null, openRequestKey: null }),
  );

  it("keeps watches, navigation and reading progress separate after the project's account changes", () => {
    const environmentId = EnvironmentId.make("env-1");
    const referenceA = {
      projectId: ProjectId.make("project-1"),
      host: "github.com",
      repository: "owner/repo",
      number: 7,
      expectedAccountId: "account-a",
    };
    const referenceB = { ...referenceA, expectedAccountId: "account-b" };
    const keyA = guideRunKey(environmentId, referenceA);
    const keyB = guideRunKey(environmentId, referenceB);
    const watch = {
      environmentId,
      title: "Improve reviews",
      previousGuideAt: null,
      previousFailedAt: null,
      since: 100,
    };
    const store = useGuideRunStore.getState();
    store.watch({ ...watch, reference: referenceA });
    store.setProgress(guideProgressKey(keyA, "same-head"), () => ({
      position: 2,
      seen: new Set([0, 1]),
    }));
    store.setShown(keyA);
    store.requestOpen(keyA);

    expect(useGuideRunStore.getState().watches[keyB]).toBeUndefined();
    expect(
      useGuideRunStore.getState().progress[guideProgressKey(keyB, "same-head")],
    ).toBeUndefined();
    expect(useGuideRunStore.getState().shownKey).not.toBe(keyB);
    expect(useGuideRunStore.getState().openRequestKey).not.toBe(keyB);
    store.watch({ ...watch, reference: referenceB });
    expect(Object.keys(useGuideRunStore.getState().watches)).toHaveLength(2);
    store.settle(keyB);
    expect(useGuideRunStore.getState().watches[keyA]?.reference.expectedAccountId).toBe(
      "account-a",
    );
    expect(
      useGuideRunStore.getState().progress[guideProgressKey(keyA, "same-head")]?.position,
    ).toBe(2);
  });
});
