import { describe, it, expect } from "vitest";
import { ChatService } from "../../src/services/chatService.js";

describe("ChatService unit", () => {
  it("streams chunks and remembers previousResponseId per session", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const seenPreviousIds: Array<string | undefined> = [];
    let responseCounter = 0;

    const chatService = new ChatService({
      runFn: async (_agent, _message, options) => {
        seenPreviousIds.push(options.previousResponseId);
        responseCounter += 1;

        return {
          toTextStream: () => ({
            async *[Symbol.asyncIterator]() {
              yield `chunk-${responseCounter}`;
            },
          }),
          completed: Promise.resolve(),
          lastResponseId: `resp-${responseCounter}`,
        };
      },
    });

    const chunks1: string[] = [];
    await chatService.streamChat({
      message: "hello",
      sessionId: "unit-1",
      onChunk: (chunk) => chunks1.push(chunk),
    });

    const chunks2: string[] = [];
    await chatService.streamChat({
      message: "hello again",
      sessionId: "unit-1",
      onChunk: (chunk) => chunks2.push(chunk),
    });

    expect(chunks1.join("")).toBe("chunk-1");
    expect(chunks2.join("")).toBe("chunk-2");
    expect(seenPreviousIds).toEqual([undefined, "resp-1"]);
  });

  it("resetSession clears stored previousResponseId", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const seenPreviousIds: Array<string | undefined> = [];
    let responseCounter = 0;

    const chatService = new ChatService({
      runFn: async (_agent, _message, options) => {
        seenPreviousIds.push(options.previousResponseId);
        responseCounter += 1;

        return {
          toTextStream: () => ({
            async *[Symbol.asyncIterator]() {
              yield "ok";
            },
          }),
          completed: Promise.resolve(),
          lastResponseId: `resp-${responseCounter}`,
        };
      },
    });

    await chatService.streamChat({
      message: "first",
      sessionId: "unit-reset",
      onChunk: () => {},
    });

    chatService.resetSession("unit-reset");

    await chatService.streamChat({
      message: "second",
      sessionId: "unit-reset",
      onChunk: () => {},
    });

    expect(seenPreviousIds).toEqual([undefined, undefined]);
  });
});
