import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app.js";
import { ChatService } from "../../src/services/chatService.js";

function createMockedChatService(chunks: string[]) {
  return new ChatService({
    runFn: async () => ({
      toTextStream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      }),
      completed: Promise.resolve(),
      lastResponseId: "resp_mock_1",
    }),
  });
}

describe("chat stream routes", () => {
  it("POST /api/chat streams text content", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const chatService = createMockedChatService(["你好", "，世界"]);
    const app = createApp(chatService);

    const response = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "請打招呼", sessionId: "stream-1" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.text).toBe("你好，世界");
  });

  it("POST /api/chat appends C# fallback source block when missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const chatService = createMockedChatService(["這是 C# 回覆內容"]);
    const app = createApp(chatService);

    const response = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "請解釋 C# class", sessionId: "stream-2" });

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/這是 C# 回覆內容/);
    expect(response.text).toMatch(/【來源】/);
    expect(response.text).toMatch(/無（本次未使用 MS Learn MCP）/);
  });

  it("POST /api/chat falls back to general route when C# run fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let callCount = 0;

    const chatService = new ChatService({
      runFn: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("mcp run failed");
        }

        return {
          toTextStream: () => ({
            async *[Symbol.asyncIterator]() {
              yield "fallback 成功";
            },
          }),
          completed: Promise.resolve(),
          lastResponseId: "resp_fallback_ok",
        };
      },
    });

    const app = createApp(chatService);
    const response = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "請解釋 C# 介面", sessionId: "fallback-1" });

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/fallback 成功/);
    expect(callCount).toBe(2);
  });

  it("POST /api/chat preserves and reset clears previousResponseId by session", async () => {
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
              yield `reply-${responseCounter}`;
            },
          }),
          completed: Promise.resolve(),
          lastResponseId: `resp-${responseCounter}`,
        };
      },
    });

    const app = createApp(chatService);

    const first = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "第一句", sessionId: "memory-1" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "第二句", sessionId: "memory-1" });
    expect(second.status).toBe(200);

    const reset = await request(app)
      .post("/api/reset")
      .set("Content-Type", "application/json")
      .send({ sessionId: "memory-1" });
    expect(reset.status).toBe(200);

    const third = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "第三句", sessionId: "memory-1" });
    expect(third.status).toBe(200);

    expect(seenPreviousIds).toEqual([undefined, "resp-1", undefined]);
  });

  it("POST /api/chat returns 500 when non-C# run fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const chatService = new ChatService({
      runFn: async () => {
        throw new Error("general run failed");
      },
    });

    const app = createApp(chatService);
    const response = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "請介紹 JavaScript", sessionId: "err-1" });

    expect(response.status).toBe(500);
    const errorText =
      typeof response.body?.error === "string"
        ? response.body.error
        : response.text;
    expect(errorText).toMatch(/general run failed/);
  });

  it("POST /api/chat appends server-error after streaming started", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const chatService = new ChatService({
      runFn: async () => ({
        toTextStream: () => ({
          async *[Symbol.asyncIterator]() {
            yield "第一段";
            throw new Error("stream broke");
          },
        }),
        completed: Promise.resolve(),
        lastResponseId: "resp_partial",
      }),
    });

    const app = createApp(chatService);
    const response = await request(app)
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send({ message: "一般訊息", sessionId: "err-2" });

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/^第一段/);
    expect(response.text).toMatch(/\[server-error\] stream broke/);
  });
});
