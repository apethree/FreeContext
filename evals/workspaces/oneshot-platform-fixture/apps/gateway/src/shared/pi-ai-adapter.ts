import {
  getModel,
  getModels,
  getProviders,
  streamSimple,
} from "@mariozechner/pi-ai";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  KnownProvider,
  Model,
  Usage,
} from "@mariozechner/pi-ai";
import type { TokenKind, TokenRecord } from "./types.js";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamDelta = {
  type: "delta";
  text: string;
};

export type StreamDone = {
  type: "done";
  fullText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
};

export type StreamError = {
  type: "error";
  error: string;
};

export type StreamEvent = StreamDelta | StreamDone | StreamError;

export type LlmCallParams = {
  provider: string;
  model: string;
  token: string;
  messages: LlmMessage[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  accountId?: string;
  sessionId?: string;
};

const PROVIDER_ALIASES: Record<string, string> = {
  claude: "anthropic",
  moonshot: "kimi-coding",
};

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function normalizeProviderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

function createZeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function assistantHistoryMessage(model: Model<Api>, text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createZeroUsage(),
    stopReason: "stop",
    timestamp,
  };
}

function extractMessageText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function usageFromMessage(message: AssistantMessage): StreamDone["usage"] | undefined {
  const usage = message.usage;
  if (!usage) return undefined;
  return {
    promptTokens: usage.input,
    completionTokens: usage.output,
  };
}

function listKnownProviders(): string[] {
  return getProviders().map((provider) => provider.toLowerCase());
}

function resolvePiProvider(params: LlmCallParams & { tokenRecord: TokenRecord }): string {
  const explicit = asNonEmptyString(params.tokenRecord.piProviderId)?.toLowerCase();
  if (explicit) return explicit;

  const tokenKind = params.tokenRecord.tokenKind;
  let provider = normalizeProviderName(params.provider);

  if (provider === "openai") {
    return tokenKind === "oauth" ? "openai-codex" : "openai";
  }

  if (provider === "openai-codex") {
    return tokenKind === "oauth" ? "openai-codex" : "openai";
  }

  if (provider === "gemini") {
    return tokenKind === "oauth" ? "google-gemini-cli" : "google";
  }

  if (provider === "google-gemini-cli" || provider === "gemini-cli") {
    return tokenKind === "oauth" ? "google-gemini-cli" : "google";
  }

  if (provider === "google") {
    return tokenKind === "oauth" ? "google-gemini-cli" : "google";
  }

  if (provider === "ollama") {
    return "ollama";
  }

  if (provider === "anthropic") {
    return "anthropic";
  }

  const known = new Set(listKnownProviders());
  if (known.has(provider)) {
    return provider;
  }

  const oauthProviderId = asNonEmptyString(params.tokenRecord.oauthProviderId)?.toLowerCase();
  if (oauthProviderId && known.has(oauthProviderId)) {
    return oauthProviderId;
  }

  const knownList = [...known].sort().join(", ");
  throw new Error(`Unsupported provider: ${params.provider}. Known providers: ${knownList}`);
}

function resolveApiKey(piProvider: string, tokenRecord: TokenRecord): string {
  if (piProvider === "google-gemini-cli") {
    const projectId = asNonEmptyString(tokenRecord.projectId);
    if (!projectId) {
      throw new Error("Gemini OAuth tokens require projectId for google-gemini-cli");
    }
    return JSON.stringify({ token: tokenRecord.token, projectId });
  }

  if (piProvider === "ollama") {
    const token = tokenRecord.token.trim();
    return token || "ollama";
  }

  return tokenRecord.token;
}

function buildOllamaModel(modelId: string, tokenRecord: TokenRecord): Model<"openai-completions"> {
  const metadata = asRecord(tokenRecord.metadata);
  const baseUrl = asNonEmptyString(metadata?.ollamaBaseUrl) ?? DEFAULT_OLLAMA_BASE_URL;
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "ollama",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
  };
}

function resolveModel(piProvider: string, modelId: string, tokenRecord: TokenRecord): Model<Api> {
  if (piProvider === "ollama") {
    return buildOllamaModel(modelId, tokenRecord);
  }

  try {
    return getModel(piProvider as KnownProvider, modelId as never);
  } catch {
    try {
      const supported = getModels(piProvider as KnownProvider)
        .map((model) => model.id)
        .sort()
        .join(", ");
      throw new Error(`Model ${modelId} is not available for provider ${piProvider}. Supported models: ${supported}`);
    } catch {
      throw new Error(`Model ${modelId} is not available for provider ${piProvider}`);
    }
  }
}

function toContext(model: Model<Api>, params: LlmCallParams): Context {
  const timestampBase = Date.now();
  const systemParts: string[] = [];
  if (asNonEmptyString(params.system)) {
    systemParts.push(params.system!.trim());
  }

  const messages: Context["messages"] = [];

  for (let index = 0; index < params.messages.length; index += 1) {
    const message = params.messages[index];
    const content = message.content.trim();
    if (!content) continue;

    if (message.role === "system") {
      systemParts.push(content);
      continue;
    }

    if (message.role === "user") {
      messages.push({ role: "user", content, timestamp: timestampBase + index });
      continue;
    }

    messages.push(assistantHistoryMessage(model, content, timestampBase + index));
  }

  const systemPrompt = systemParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")
    || DEFAULT_SYSTEM_PROMPT;

  return {
    systemPrompt,
    messages,
  };
}

function mapPiAiEventsToStream(eventStream: AssistantMessageEventStream): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    async start(controller) {
      try {
        for await (const event of eventStream) {
          const typedEvent = event as AssistantMessageEvent;

          if (typedEvent.type === "text_delta") {
            controller.enqueue({ type: "delta", text: typedEvent.delta });
            continue;
          }

          if (typedEvent.type === "done") {
            controller.enqueue({
              type: "done",
              fullText: extractMessageText(typedEvent.message),
              usage: usageFromMessage(typedEvent.message),
            });
            controller.close();
            return;
          }

          if (typedEvent.type === "error") {
            controller.enqueue({
              type: "error",
              error: typedEvent.error.errorMessage || "Unknown error",
            });
            controller.close();
            return;
          }
        }

        controller.close();
      } catch (error) {
        controller.enqueue({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        controller.close();
      }
    },
  });
}

export async function callLlmProviderStream(
  params: LlmCallParams & { tokenRecord: TokenRecord },
): Promise<ReadableStream<StreamEvent>> {
  const token = params.tokenRecord.token.trim();
  if (!token) {
    throw new Error("Token record is missing token");
  }

  const piProvider = resolvePiProvider(params);
  const model = resolveModel(piProvider, params.model, params.tokenRecord);
  const context = toContext(model, params);
  const apiKey = resolveApiKey(piProvider, params.tokenRecord);

  const eventStream = streamSimple(model as Model<Api>, context, {
    apiKey,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    transport: "sse",
    sessionId: params.sessionId,
  });

  return mapPiAiEventsToStream(eventStream);
}

export async function refreshOAuthTokenViaPiAi(
  oauthProviderId: string,
  tokenRecord: TokenRecord,
): Promise<TokenRecord | null> {
  const providerId = oauthProviderId.trim().toLowerCase();
  if (!providerId) {
    throw new Error("oauthProviderId is required for refresh");
  }

  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`Unsupported OAuth provider: ${providerId}`);
  }

  const refreshToken = asNonEmptyString(tokenRecord.refreshToken);
  if (!refreshToken) {
    return null;
  }

  const credentials: Record<string, unknown> = {
    access: tokenRecord.token,
    refresh: refreshToken,
    expires: tokenRecord.expiresAtMs ?? Date.now(),
  };

  if (asNonEmptyString(tokenRecord.projectId)) {
    credentials.projectId = tokenRecord.projectId;
  }
  if (asNonEmptyString(tokenRecord.accountId)) {
    credentials.accountId = tokenRecord.accountId;
  }
  if (asNonEmptyString(tokenRecord.email)) {
    credentials.email = tokenRecord.email;
  }

  const refreshed = await provider.refreshToken(credentials as {
    refresh: string;
    access: string;
    expires: number;
    [key: string]: unknown;
  });

  return {
    ...tokenRecord,
    token: refreshed.access,
    refreshToken: refreshed.refresh,
    expiresAtMs: refreshed.expires,
    ...(asNonEmptyString((refreshed as Record<string, unknown>).email) ? { email: asNonEmptyString((refreshed as Record<string, unknown>).email)! } : {}),
    tokenKind: "oauth" as TokenKind,
    oauthProviderId: providerId,
    updatedAtMs: Date.now(),
  };
}
