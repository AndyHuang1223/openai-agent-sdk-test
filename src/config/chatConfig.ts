export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type ChatConfig = {
  serviceName: string;
  agents: {
    general: {
      name: string;
      model: string;
      instructions: string;
    };
    csharp: {
      name: string;
      model: string;
      instructionsWithMcp: string;
      instructionsWithoutMcp: string;
    };
    csharpFallback: {
      name: string;
      model: string;
      instructions: string;
    };
  };
  mcp: {
    msLearnUrl: string;
  };
  routing: {
    enableCsharpRoute: boolean;
    csharpOnlyUsesMcp: boolean;
  };
  csharpKeywords: string[];
  sourceBlock: {
    rule: string;
    fallback: string;
  };
};

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  serviceName: "openai-agent-sdk-test",
  agents: {
    general: {
      name: "Tutor",
      model: "gpt-4.1-mini",
      instructions:
        "你是一位親切的程式導師。請用繁體中文回答，並用初學者容易懂的方式解釋。",
    },
    csharp: {
      name: "CSharpTutor",
      model: "gpt-4.1-mini",
      instructionsWithMcp:
        "你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若問題與 C#/.NET 相關，優先使用 MS Learn MCP 工具查證內容。",
      instructionsWithoutMcp:
        "你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。若目前無法取得 MS Learn MCP 工具，請誠實告知無法引用官方來源連結。",
    },
    csharpFallback: {
      name: "CSharpTutorFallback",
      model: "gpt-4.1-mini",
      instructions:
        "你是一位親切的 C# 與 .NET 導師。請用繁體中文回答，並用初學者容易懂的方式解釋。本次請不要呼叫任何 MCP 工具，直接根據既有知識提供答案。",
    },
  },
  mcp: {
    msLearnUrl: "",
  },
  routing: {
    enableCsharpRoute: true,
    csharpOnlyUsesMcp: true,
  },
  csharpKeywords: [
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
  ],
  sourceBlock: {
    rule: "回覆最後必須固定附上以下格式的來源區塊：\n【來源】\n- MS Learn: <https://learn.microsoft.com/...>\n若本次無法取得 MS Learn 來源，請改為：\n【來源】\n- 無（本次未使用 MS Learn MCP）",
    fallback: "\n\n【來源】\n- 無（本次未使用 MS Learn MCP）",
  },
};

export function mergeChatConfig(
  base: ChatConfig,
  override?: DeepPartial<ChatConfig>,
): ChatConfig {
  if (!override) {
    return base;
  }

  return {
    serviceName: override.serviceName ?? base.serviceName,
    agents: {
      general: {
        name: override.agents?.general?.name ?? base.agents.general.name,
        model: override.agents?.general?.model ?? base.agents.general.model,
        instructions:
          override.agents?.general?.instructions ??
          base.agents.general.instructions,
      },
      csharp: {
        name: override.agents?.csharp?.name ?? base.agents.csharp.name,
        model: override.agents?.csharp?.model ?? base.agents.csharp.model,
        instructionsWithMcp:
          override.agents?.csharp?.instructionsWithMcp ??
          base.agents.csharp.instructionsWithMcp,
        instructionsWithoutMcp:
          override.agents?.csharp?.instructionsWithoutMcp ??
          base.agents.csharp.instructionsWithoutMcp,
      },
      csharpFallback: {
        name:
          override.agents?.csharpFallback?.name ??
          base.agents.csharpFallback.name,
        model:
          override.agents?.csharpFallback?.model ??
          base.agents.csharpFallback.model,
        instructions:
          override.agents?.csharpFallback?.instructions ??
          base.agents.csharpFallback.instructions,
      },
    },
    mcp: {
      msLearnUrl: override.mcp?.msLearnUrl ?? base.mcp.msLearnUrl,
    },
    routing: {
      enableCsharpRoute:
        override.routing?.enableCsharpRoute ?? base.routing.enableCsharpRoute,
      csharpOnlyUsesMcp:
        override.routing?.csharpOnlyUsesMcp ?? base.routing.csharpOnlyUsesMcp,
    },
    csharpKeywords: override.csharpKeywords ?? base.csharpKeywords,
    sourceBlock: {
      rule: override.sourceBlock?.rule ?? base.sourceBlock.rule,
      fallback: override.sourceBlock?.fallback ?? base.sourceBlock.fallback,
    },
  };
}
