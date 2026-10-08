import { defineConfig } from "@coderabbitai/config";

// This fork uses CI and owner review instead of automatic CodeRabbit activity.
export default defineConfig({
  reviews: {
    high_level_summary: false,
    review_status: false,
    review_progress: false,
    commit_status: false,
    request_changes_workflow: false,
    auto_review: {
      enabled: false,
      auto_incremental_review: false,
    },
  },
  chat: {
    auto_reply: false,
  },
});
