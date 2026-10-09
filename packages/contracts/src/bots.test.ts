import { describe, expect, it } from "vite-plus/test";

import { BotId, botIdForThread, botMainThreadId, botTaskId, botTaskThreadId } from "./bots.ts";

describe("botIdForThread", () => {
  const botId = BotId.make("bot:profile:home:a%2Fb");

  it("reads the owner of main and task conversations", () => {
    expect(botIdForThread(botMainThreadId(botId))).toBe(botId);
    expect(botIdForThread(botTaskThreadId(botTaskId(botId, "job: 1/2")))).toBe(botId);
  });

  it("ignores ordinary and malformed thread ids", () => {
    expect(botIdForThread("thread-1")).toBeNull();
    expect(botIdForThread("bot:task::job:thread")).toBeNull();
    expect(botIdForThread("bot:task:%E0:job:thread")).toBeNull();
  });
});
