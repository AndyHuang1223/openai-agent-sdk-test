import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";

/** 伺服器埠號，預設為 3000。 */
const PORT = Number(process.env.PORT ?? 3000);

/** 前端靜態資源目錄。 */
const PUBLIC_DIR = join(process.cwd(), "public");

/** MS Learn MCP（Streamable HTTP）端點。 */
const MS_LEARN_MCP_URL = process.env.MS_LEARN_MCP_URL?.trim() ?? "";

/** C#/.NET 問題關鍵字。 */
const CSHARP_KEYWORDS = [
  "c#",
  "c sharp",
  ".net",
  "dotnet",
  "asp.net",
  "aspnet",
  "blazor",
  "linq",
  "entity framework",
  "ef core",
  "xunit",
  "nunit",
  "c# 12",
  "c# 13",
] as const;

const msLearnMcpServer = MS_LEARN_MCP_URL
  ? new MCPServerStreamableHttp({
      name: "ms-learn",
      url: MS_LEARN_MCP_URL,
    })
  : null;

const hasMsLearnMcp = msLearnMcpServer !== null;
let msLearnMcpConnected = false;
let msLearnMcpConnectPromise: Promise<void> | null = null;

const CSHARP_SOURCE_BLOCK_RULE =
  "回覆最後必須固定附上以下格式的來源區塊：\n【來源】\n- MS Learn: <https://learn.microsoft.com/...>\n若本次無法取得 MS Learn 來源，請改為：\n【來源】\n- 無（本次未使用 MS Learn MCP）";

const CSHARP_FALLBACK_SOURCE_BLOCK =
  "\n\n【來源】\n- 無（本次未使用 MS Learn MCP）";

/**
 * 教學型 Agent：以繁體中文、初學者友善的語氣回答。
 */
const generalAgent = new Agent({
  name: "Tutor",
  instructions:
    "你是一位親切的程式導師。請用繁體中文回答，並用初學者容易懂的方式解釋。",
  model: "gpt-4.1-mini",
});

const csharpAgent = new Agent({
  name: "CSharpTutor",
  instructions: hasMsLearnMcp
    ? `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若問題與 C#/.NET 相關，優先使用 MS Learn MCP 工具查證內容。${CSHARP_SOURCE_BLOCK_RULE}`
    : `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若目前無法取得 MS Learn MCP 工具，請誠實告知無法引用官方來源連結。${CSHARP_SOURCE_BLOCK_RULE}`,
  model: "gpt-4.1-mini",
  mcpServers: msLearnMcpServer ? [msLearnMcpServer] : [],
});

const csharpFallbackAgent = new Agent({
  name: "CSharpTutorFallback",
  instructions: `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。本次請不要呼叫任何 MCP 工具，直接根據既有知識提供答案。${CSHARP_SOURCE_BLOCK_RULE}`,
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
 * 以關鍵字判斷是否為 C#/.NET 相關提問。
 * @param message 使用者訊息
 * @returns 是否命中 C#/.NET 路由
 */
function isCSharpQuery(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return CSHARP_KEYWORDS.some((keyword) => normalizedMessage.includes(keyword));
}

/**
 * 確保 MS Learn MCP 已連線（僅初始化一次）。
 * @returns 是否可用
 */
async function ensureMsLearnMcpConnected(): Promise<boolean> {
  if (!msLearnMcpServer) {
    return false;
  }

  if (msLearnMcpConnected) {
    return true;
  }

  if (!msLearnMcpConnectPromise) {
    msLearnMcpConnectPromise = msLearnMcpServer
      .connect()
      .then(() => {
        msLearnMcpConnected = true;
      })
      .catch((error) => {
        msLearnMcpConnectPromise = null;
        throw error;
      });
  }

  try {
    await msLearnMcpConnectPromise;
    return true;
  } catch (error) {
    console.warn("[mcp] MS Learn MCP connect 失敗", error);
    return false;
  }
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
 * - GET /api/health：回傳服務健康與設定狀態
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

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      response.end(
        JSON.stringify({
          ok: true,
          service: "openai-agent-sdk-test",
          timestamp: new Date().toISOString(),
          openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
          msLearnMcpConfigured: hasMsLearnMcp,
          msLearnMcpConnected,
          routing: {
            csharpOnlyUsesMcp: true,
          },
        }),
      );
      return;
    }

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
      const startedAt = Date.now();
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

      const wantsCSharpRoute = isCSharpQuery(message);
      const mcpReadyForCSharp = wantsCSharpRoute
        ? await ensureMsLearnMcpConnected()
        : false;
      const routeToCSharpAgent = wantsCSharpRoute;
      const selectedAgent = !wantsCSharpRoute
        ? generalAgent
        : mcpReadyForCSharp
          ? csharpAgent
          : csharpFallbackAgent;
      let fallbackReason:
        | "none"
        | "mcp-unavailable"
        | "mcp-run-failed"
        | "csharp-fallback-failed" =
        wantsCSharpRoute && !mcpReadyForCSharp ? "mcp-unavailable" : "none";

      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // 透過 previousResponseId 延續同一 session 的對話上下文。
      let streamedResult;
      try {
        streamedResult = await run(selectedAgent, message, {
          stream: true,
          previousResponseId: previousResponseBySession.get(sessionId),
        });
      } catch (error) {
        if (!wantsCSharpRoute) {
          throw error;
        }

        if (selectedAgent === csharpAgent) {
          fallbackReason = "mcp-run-failed";
          console.warn(
            "[chat] C# MCP agent 執行失敗，改用 C# fallback agent",
            error,
          );
          try {
            streamedResult = await run(csharpFallbackAgent, message, {
              stream: true,
              previousResponseId: previousResponseBySession.get(sessionId),
            });
          } catch (fallbackError) {
            fallbackReason = "csharp-fallback-failed";
            console.warn(
              "[chat] C# fallback agent 也失敗，改用一般 agent",
              fallbackError,
            );
            streamedResult = await run(generalAgent, message, {
              stream: true,
              previousResponseId: previousResponseBySession.get(sessionId),
            });
          }
        } else {
          fallbackReason = "csharp-fallback-failed";
          console.warn(
            "[chat] C# fallback agent 執行失敗，改用一般 agent",
            error,
          );
          streamedResult = await run(generalAgent, message, {
            stream: true,
            previousResponseId: previousResponseBySession.get(sessionId),
          });
        }
      }

      const textStream = streamedResult.toTextStream({
        compatibleWithNodeStreams: true,
      });

      let streamedText = "";

      for await (const chunk of textStream) {
        streamedText += chunk;
        response.write(chunk);
      }

      if (wantsCSharpRoute && !streamedText.includes("【來源】")) {
        response.write(CSHARP_FALLBACK_SOURCE_BLOCK);
      }

      // 串流完成後記錄最新 responseId，供下次請求使用。
      await streamedResult.completed;
      if (streamedResult.lastResponseId) {
        previousResponseBySession.set(sessionId, streamedResult.lastResponseId);
      }

      console.log(
        `[chat] session=${sessionId} route=${routeToCSharpAgent ? "csharp" : "general"} mcpConfigured=${hasMsLearnMcp ? "yes" : "no"} mcpConnected=${msLearnMcpConnected ? "yes" : "no"} fallbackReason=${fallbackReason} durationMs=${Date.now() - startedAt}`,
      );

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

    if (response.headersSent) {
      if (!response.writableEnded) {
        response.end(`\n\n[server-error] ${message}`);
      }
      return;
    }

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
