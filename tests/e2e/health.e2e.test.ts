import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";

const HEALTH_PATH = "/api/health";

describe("E2E health check", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const { createApp } = await import("../../src/app.js");
    const app = createApp();
    server = createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("returns healthy response contract", async () => {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`);
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      openAiApiKeyConfigured: boolean;
      routing: { csharpOnlyUsesMcp: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("openai-agent-sdk-test");
    expect(body.openAiApiKeyConfigured).toBe(true);
    expect(body.routing.csharpOnlyUsesMcp).toBe(true);
  });
});
