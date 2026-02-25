import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app.js";

describe("app routes", () => {
  it("GET /api/health returns service status", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("openai-agent-sdk-test");
  });

  it("GET /api/health matches response contract keys", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const app = createApp();

    const response = await request(app).get("/api/health");

    const keys = Object.keys(response.body).sort();
    expect(keys).toEqual([
      "msLearnMcpConfigured",
      "msLearnMcpConnected",
      "ok",
      "openAiApiKeyConfigured",
      "routing",
      "service",
      "timestamp",
    ]);
    expect(Object.keys(response.body.routing).sort()).toEqual([
      "csharpOnlyUsesMcp",
    ]);
  });

  it("GET / and static assets are served", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const app = createApp();

    const html = await request(app).get("/");
    expect(html.status).toBe(200);
    expect(html.headers["content-type"]).toMatch(/text\/html/);

    const js = await request(app).get("/app.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);

    const css = await request(app).get("/styles.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/text\/css/);
  });

  it("POST /api/reset returns ok", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const app = createApp();

    const response = await request(app)
      .post("/api/reset")
      .send({ sessionId: "session-1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("POST /api/chat with empty message returns 400", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const app = createApp();

    const response = await request(app)
      .post("/api/chat")
      .send({ message: "   ", sessionId: "session-2" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("message 不可為空");
  });

  it("missing OPENAI_API_KEY returns 500", async () => {
    delete process.env.OPENAI_API_KEY;
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("缺少 OPENAI_API_KEY，請先設定 .env");
  });
});
