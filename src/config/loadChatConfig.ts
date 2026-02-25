import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CHAT_CONFIG,
  type ChatConfig,
  type DeepPartial,
  mergeChatConfig,
} from "./chatConfig.js";

type LoadChatConfigOptions = {
  override?: DeepPartial<ChatConfig>;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter(
    (item): item is string => typeof item === "string",
  );
  return values.length === value.length ? values : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function toPartialChatConfig(value: unknown): DeepPartial<ChatConfig> {
  if (!isObject(value)) {
    return {};
  }

  const agents = isObject(value.agents) ? value.agents : undefined;
  const general =
    agents && isObject(agents.general) ? agents.general : undefined;
  const csharp = agents && isObject(agents.csharp) ? agents.csharp : undefined;
  const csharpFallback =
    agents && isObject(agents.csharpFallback)
      ? agents.csharpFallback
      : undefined;

  const mcp = isObject(value.mcp) ? value.mcp : undefined;
  const routing = isObject(value.routing) ? value.routing : undefined;
  const sourceBlock = isObject(value.sourceBlock)
    ? value.sourceBlock
    : undefined;

  return {
    serviceName: asString(value.serviceName),
    agents: {
      general: {
        name: asString(general?.name),
        model: asString(general?.model),
        instructions: asString(general?.instructions),
      },
      csharp: {
        name: asString(csharp?.name),
        model: asString(csharp?.model),
        instructionsWithMcp: asString(csharp?.instructionsWithMcp),
        instructionsWithoutMcp: asString(csharp?.instructionsWithoutMcp),
      },
      csharpFallback: {
        name: asString(csharpFallback?.name),
        model: asString(csharpFallback?.model),
        instructions: asString(csharpFallback?.instructions),
      },
    },
    mcp: {
      msLearnUrl: asString(mcp?.msLearnUrl),
    },
    routing: {
      enableCsharpRoute: asBoolean(routing?.enableCsharpRoute),
      csharpOnlyUsesMcp: asBoolean(routing?.csharpOnlyUsesMcp),
    },
    csharpKeywords: asStringArray(value.csharpKeywords),
    sourceBlock: {
      rule: asString(sourceBlock?.rule),
      fallback: asString(sourceBlock?.fallback),
    },
  };
}

function loadJsonConfig(configPath: string): DeepPartial<ChatConfig> {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return toPartialChatConfig(parsed);
  } catch (error) {
    console.warn(`[config] 無法讀取 chat config: ${configPath}`, error);
    return {};
  }
}

function envOverrides(env: NodeJS.ProcessEnv): DeepPartial<ChatConfig> {
  return {
    serviceName: env.CHAT_SERVICE_NAME,
    agents: {
      general: {
        model: env.CHAT_MODEL_GENERAL,
      },
      csharp: {
        model: env.CHAT_MODEL_CSHARP,
      },
      csharpFallback: {
        model: env.CHAT_MODEL_CSHARP_FALLBACK,
      },
    },
    mcp: {
      msLearnUrl: env.MS_LEARN_MCP_URL,
    },
    routing: {
      enableCsharpRoute: parseBooleanEnv(env.CHAT_ROUTING_ENABLE_CSHARP_ROUTE),
      csharpOnlyUsesMcp: parseBooleanEnv(env.CHAT_ROUTING_CSHARP_ONLY_USES_MCP),
    },
  };
}

export function loadChatConfig(options?: LoadChatConfigOptions): ChatConfig {
  const env = options?.env ?? process.env;
  const configPath =
    options?.configPath ??
    env.CHAT_CONFIG_PATH ??
    join(process.cwd(), "config", "chat.json");

  const fromJson = loadJsonConfig(configPath);
  const fromEnv = envOverrides(env);

  const withJson = mergeChatConfig(DEFAULT_CHAT_CONFIG, fromJson);
  const withEnv = mergeChatConfig(withJson, fromEnv);
  return mergeChatConfig(withEnv, options?.override);
}
