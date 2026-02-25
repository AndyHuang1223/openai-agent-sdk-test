import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";
import {
  type ChatConfig,
  type DeepPartial,
  mergeChatConfig,
} from "../config/chatConfig.js";
import { loadChatConfig } from "../config/loadChatConfig.js";

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

function appendSourceRule(instructions: string, sourceRule: string): string {
  return `${instructions}${sourceRule}`;
}

export class ChatService {
  private readonly config: ChatConfig;

  private readonly msLearnMcpServer: MCPServerStreamableHttp | null;

  private readonly hasMsLearnMcp: boolean;

  private msLearnMcpConnected = false;

  private msLearnMcpConnectPromise: Promise<void> | null = null;

  private readonly previousResponseBySession = new Map<string, string>();

  private readonly generalAgent: Agent;

  private readonly csharpAgent: Agent;

  private readonly csharpFallbackAgent: Agent;

  private readonly runFn: RunFn;

  constructor(options?: { runFn?: RunFn; config?: DeepPartial<ChatConfig> }) {
    const loadedConfig = loadChatConfig();
    this.config = mergeChatConfig(loadedConfig, options?.config);

    const msLearnMcpUrl = this.config.mcp.msLearnUrl.trim();

    this.msLearnMcpServer = msLearnMcpUrl
      ? new MCPServerStreamableHttp({
          name: "ms-learn",
          url: msLearnMcpUrl,
        })
      : null;

    this.hasMsLearnMcp = this.msLearnMcpServer !== null;

    this.generalAgent = new Agent({
      name: this.config.agents.general.name,
      instructions: this.config.agents.general.instructions,
      model: this.config.agents.general.model,
    });

    this.csharpAgent = new Agent({
      name: this.config.agents.csharp.name,
      instructions: this.hasMsLearnMcp
        ? appendSourceRule(
            this.config.agents.csharp.instructionsWithMcp,
            this.config.sourceBlock.rule,
          )
        : appendSourceRule(
            this.config.agents.csharp.instructionsWithoutMcp,
            this.config.sourceBlock.rule,
          ),
      model: this.config.agents.csharp.model,
      mcpServers: this.msLearnMcpServer ? [this.msLearnMcpServer] : [],
    });

    this.csharpFallbackAgent = new Agent({
      name: this.config.agents.csharpFallback.name,
      instructions: appendSourceRule(
        this.config.agents.csharpFallback.instructions,
        this.config.sourceBlock.rule,
      ),
      model: this.config.agents.csharpFallback.model,
    });

    this.runFn = options?.runFn ?? run;
  }

  getHealth() {
    return {
      ok: true,
      service: this.config.serviceName,
      timestamp: new Date().toISOString(),
      openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      msLearnMcpConfigured: this.hasMsLearnMcp,
      msLearnMcpConnected: this.msLearnMcpConnected,
      routing: {
        csharpOnlyUsesMcp: this.config.routing.csharpOnlyUsesMcp,
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

    const wantsCSharpRoute =
      this.config.routing.enableCsharpRoute && this.isCSharpQuery(message);
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
      onChunk(this.config.sourceBlock.fallback);
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
    return this.config.csharpKeywords.some((keyword) =>
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
