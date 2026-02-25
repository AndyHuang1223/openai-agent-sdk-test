import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";

type RunResult = {
  toTextStream: (options: {
    compatibleWithNodeStreams: boolean;
  }) => AsyncIterable<string>;
  completed: Promise<void>;
  lastResponseId?: string;
};

type RunFn = (
  agent: Agent,
  message: string,
  options: {
    stream: true;
    previousResponseId?: string;
  },
) => Promise<RunResult>;

type FallbackReason =
  | "none"
  | "mcp-unavailable"
  | "mcp-run-failed"
  | "csharp-fallback-failed";

const MS_LEARN_MCP_URL = process.env.MS_LEARN_MCP_URL?.trim() ?? "";

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

const CSHARP_SOURCE_BLOCK_RULE =
  "回覆最後必須固定附上以下格式的來源區塊：\n【來源】\n- MS Learn: <https://learn.microsoft.com/...>\n若本次無法取得 MS Learn 來源，請改為：\n【來源】\n- 無（本次未使用 MS Learn MCP）";

const CSHARP_FALLBACK_SOURCE_BLOCK =
  "\n\n【來源】\n- 無（本次未使用 MS Learn MCP）";

export class ChatService {
  private readonly msLearnMcpServer: MCPServerStreamableHttp | null;

  private readonly hasMsLearnMcp: boolean;

  private msLearnMcpConnected = false;

  private msLearnMcpConnectPromise: Promise<void> | null = null;

  private readonly previousResponseBySession = new Map<string, string>();

  private readonly generalAgent = new Agent({
    name: "Tutor",
    instructions:
      "你是一位親切的程式導師。請用繁體中文回答，並用初學者容易懂的方式解釋。",
    model: "gpt-4.1-mini",
  });

  private readonly csharpAgent: Agent;

  private readonly csharpFallbackAgent = new Agent({
    name: "CSharpTutorFallback",
    instructions: `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。本次請不要呼叫任何 MCP 工具，直接根據既有知識提供答案。${CSHARP_SOURCE_BLOCK_RULE}`,
    model: "gpt-4.1-mini",
  });

  private readonly runFn: RunFn;

  constructor(options?: { runFn?: RunFn }) {
    this.msLearnMcpServer = MS_LEARN_MCP_URL
      ? new MCPServerStreamableHttp({
          name: "ms-learn",
          url: MS_LEARN_MCP_URL,
        })
      : null;

    this.hasMsLearnMcp = this.msLearnMcpServer !== null;

    this.csharpAgent = new Agent({
      name: "CSharpTutor",
      instructions: this.hasMsLearnMcp
        ? `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若問題與 C#/.NET 相關，優先使用 MS Learn MCP 工具查證內容。${CSHARP_SOURCE_BLOCK_RULE}`
        : `你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若目前無法取得 MS Learn MCP 工具，請誠實告知無法引用官方來源連結。${CSHARP_SOURCE_BLOCK_RULE}`,
      model: "gpt-4.1-mini",
      mcpServers: this.msLearnMcpServer ? [this.msLearnMcpServer] : [],
    });

    this.runFn = options?.runFn ?? run;
  }

  getHealth() {
    return {
      ok: true,
      service: "openai-agent-sdk-test",
      timestamp: new Date().toISOString(),
      openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      msLearnMcpConfigured: this.hasMsLearnMcp,
      msLearnMcpConnected: this.msLearnMcpConnected,
      routing: {
        csharpOnlyUsesMcp: true,
      },
    };
  }

  resetSession(sessionId: string): void {
    if (sessionId) {
      this.previousResponseBySession.delete(sessionId);
    }
  }

  async streamChat(options: {
    message: string;
    sessionId: string;
    onChunk: (chunk: string) => void;
  }): Promise<void> {
    const { message, onChunk, sessionId } = options;
    const startedAt = Date.now();

    const wantsCSharpRoute = this.isCSharpQuery(message);
    const mcpReadyForCSharp = wantsCSharpRoute
      ? await this.ensureMsLearnMcpConnected()
      : false;
    const routeToCSharpAgent = wantsCSharpRoute;

    const selectedAgent = !wantsCSharpRoute
      ? this.generalAgent
      : mcpReadyForCSharp
        ? this.csharpAgent
        : this.csharpFallbackAgent;

    let fallbackReason: FallbackReason =
      wantsCSharpRoute && !mcpReadyForCSharp ? "mcp-unavailable" : "none";

    let streamedResult;
    try {
      streamedResult = await this.runFn(selectedAgent, message, {
        stream: true,
        previousResponseId: this.previousResponseBySession.get(sessionId),
      });
    } catch (error) {
      if (!wantsCSharpRoute) {
        throw error;
      }

      if (selectedAgent === this.csharpAgent) {
        fallbackReason = "mcp-run-failed";
        console.warn(
          "[chat] C# MCP agent 執行失敗，改用 C# fallback agent",
          error,
        );
        try {
          streamedResult = await this.runFn(this.csharpFallbackAgent, message, {
            stream: true,
            previousResponseId: this.previousResponseBySession.get(sessionId),
          });
        } catch (fallbackError) {
          fallbackReason = "csharp-fallback-failed";
          console.warn(
            "[chat] C# fallback agent 也失敗，改用一般 agent",
            fallbackError,
          );
          streamedResult = await this.runFn(this.generalAgent, message, {
            stream: true,
            previousResponseId: this.previousResponseBySession.get(sessionId),
          });
        }
      } else {
        fallbackReason = "csharp-fallback-failed";
        console.warn(
          "[chat] C# fallback agent 執行失敗，改用一般 agent",
          error,
        );
        streamedResult = await this.runFn(this.generalAgent, message, {
          stream: true,
          previousResponseId: this.previousResponseBySession.get(sessionId),
        });
      }
    }

    const textStream = streamedResult.toTextStream({
      compatibleWithNodeStreams: true,
    });

    let streamedText = "";

    for await (const chunk of textStream) {
      streamedText += chunk;
      onChunk(chunk);
    }

    if (wantsCSharpRoute && !streamedText.includes("【來源】")) {
      onChunk(CSHARP_FALLBACK_SOURCE_BLOCK);
    }

    await streamedResult.completed;
    if (streamedResult.lastResponseId) {
      this.previousResponseBySession.set(
        sessionId,
        streamedResult.lastResponseId,
      );
    }

    console.log(
      `[chat] session=${sessionId} route=${routeToCSharpAgent ? "csharp" : "general"} mcpConfigured=${this.hasMsLearnMcp ? "yes" : "no"} mcpConnected=${this.msLearnMcpConnected ? "yes" : "no"} fallbackReason=${fallbackReason} durationMs=${Date.now() - startedAt}`,
    );
  }

  private isCSharpQuery(message: string): boolean {
    const normalizedMessage = message.toLowerCase();
    return CSHARP_KEYWORDS.some((keyword) =>
      normalizedMessage.includes(keyword),
    );
  }

  private async ensureMsLearnMcpConnected(): Promise<boolean> {
    if (!this.msLearnMcpServer) {
      return false;
    }

    if (this.msLearnMcpConnected) {
      return true;
    }

    if (!this.msLearnMcpConnectPromise) {
      this.msLearnMcpConnectPromise = this.msLearnMcpServer
        .connect()
        .then(() => {
          this.msLearnMcpConnected = true;
        })
        .catch((error) => {
          this.msLearnMcpConnectPromise = null;
          throw error;
        });
    }

    try {
      await this.msLearnMcpConnectPromise;
      return true;
    } catch (error) {
      console.warn("[mcp] MS Learn MCP connect 失敗", error);
      return false;
    }
  }
}
