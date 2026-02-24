import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Agent, run } from "@openai/agents";

/** 伺服器埠號，預設為 3000。 */
const PORT = Number(process.env.PORT ?? 3000);

/** 前端靜態資源目錄。 */
const PUBLIC_DIR = join(process.cwd(), "public");

/**
 * 教學型 Agent：以繁體中文、初學者友善的語氣回答。
 */
const teacherAgent = new Agent({
  name: "Tutor",
  instructions:
    "你是一位親切的程式導師。請用繁體中文回答，並用初學者容易懂的方式解釋。",
  model: "gpt-4.1-mini",
});

/**
 * 以 sessionId 對應上一輪的 responseId，
 * 讓同一個 session 的後續請求可以延續對話上下文。
 */
const previousResponseBySession = new Map<string, string>();

/**
 * 依照副檔名回傳 HTTP Content-Type。
 * @param filePath 檔案路徑
 * @returns 對應的 MIME type
 */
function contentTypeByExtension(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

/**
 * 將 request body 讀出並解析為 JSON。
 * @param request Node.js HTTP request
 * @returns 解析後的 JSON 物件（若空 body 則回傳空物件）
 */
async function readJsonBody(
  request: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

/**
 * HTTP 伺服器入口：
 * - GET：回傳前端靜態檔案
 * - POST /api/chat：呼叫 Agent 串流回覆
 * - POST /api/reset：清除指定 session 記憶
 */
const server = createServer(async (request, response) => {
  try {
    // 啟動時檢查 API Key。
    if (!process.env.OPENAI_API_KEY) {
      response.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({ error: "缺少 OPENAI_API_KEY，請先設定 .env" }),
      );
      return;
    }

    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host}`,
    );

    // 提供 public/ 目錄下的靜態資源。
    if (request.method === "GET") {
      const targetPath =
        requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const filePath = join(PUBLIC_DIR, targetPath);
      const fileContent = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentTypeByExtension(filePath),
      });
      response.end(fileContent);
      return;
    }

    // 聊天端點：支援串流回傳與 session memory。
    if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
      const payload = await readJsonBody(request);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message.trim()
          : "";
      const sessionId =
        typeof payload === "object" &&
        payload !== null &&
        "sessionId" in payload &&
        typeof payload.sessionId === "string"
          ? payload.sessionId
          : "default";

      if (!message) {
        response.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "message 不可為空" }));
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // 透過 previousResponseId 延續同一 session 的對話上下文。
      const streamedResult = await run(teacherAgent, message, {
        stream: true,
        previousResponseId: previousResponseBySession.get(sessionId),
      });

      const textStream = streamedResult.toTextStream({
        compatibleWithNodeStreams: true,
      });

      for await (const chunk of textStream) {
        response.write(chunk);
      }

      // 串流完成後記錄最新 responseId，供下次請求使用。
      await streamedResult.completed;
      if (streamedResult.lastResponseId) {
        previousResponseBySession.set(sessionId, streamedResult.lastResponseId);
      }

      response.end();
      return;
    }

    // 重置指定 session 的對話記憶。
    if (request.method === "POST" && requestUrl.pathname === "/api/reset") {
      const payload = await readJsonBody(request);
      const sessionId =
        typeof payload === "object" &&
        payload !== null &&
        "sessionId" in payload &&
        typeof payload.sessionId === "string"
          ? payload.sessionId
          : "";

      if (sessionId) {
        previousResponseBySession.delete(sessionId);
      }

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    // 統一例外處理，避免錯誤直接中斷連線。
    const message = error instanceof Error ? error.message : "未知錯誤";
    response.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: message }));
  }
});

/** 啟動 HTTP 伺服器。 */
server.listen(PORT, () => {
  console.log(`Web UI 已啟動：http://localhost:${PORT}`);
});
