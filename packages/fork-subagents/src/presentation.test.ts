import { describe, expect, it } from "vite-plus/test";

import { SUBAGENT_SUMMARY_UPDATED_ACTIVITY } from "./activities.ts";
import { normalizeSubagentTranscript } from "./presentation.ts";

describe("subagent presentation", () => {
  it("removes bookkeeping from visible transcripts", () => {
    const visible = { id: "visible", kind: "runtime.info", payload: {}, summary: "visible" };
    const hidden = {
      id: "hidden",
      kind: SUBAGENT_SUMMARY_UPDATED_ACTIVITY,
      payload: {},
      summary: "hidden",
    };
    const transcript = normalizeSubagentTranscript({
      messages: [],
      activities: [visible, hidden] as never,
    });
    expect(transcript.activities).toEqual([visible]);
  });
});
