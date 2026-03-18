/**
 * LangGraph integration test — two approaches, two graphs each
 *
 * Approach A: PiCodexChatModel — delegates to pi-ai's streamOpenAICodexResponses
 *   - pi-ai handles all Codex quirks natively (JWT, headers, store:false,
 *     instructions, tool calls, SSE/WebSocket, retry logic)
 *   - Zero changes to LangGraph/LangChain core
 *
 * Approach B: Local Quotio proxy — plain ChatOpenAI, standard /v1/chat/completions
 *
 * Graph 1 (quickstart): single chat node, multi-turn conversation
 * Graph 2 (quickstart): ReAct agent with tool calling (calculator + reverse-string)
 */
import { createDecipheriv, createHmac } from "node:crypto";
import pg from "pg";
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage, AIMessage, SystemMessage, ToolMessage,
  isAIMessage, isHumanMessage, isSystemMessage, isToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { z } from "zod";
import { registerBuiltInApiProviders, getApiProvider } from "@mariozechner/pi-ai";
registerBuiltInApiProviders();
const streamOpenAICodexResponses = getApiProvider("openai-codex-responses").stream;

// ============================================================
// Config
// ============================================================
const PG_URL = "postgres://narya@127.0.0.1:5432/capzero";
const MASTER_KEY_B64 = "t412w5D6+r6/S/urHKF8R4WNKmLJvLXCpTYyMpVcpBU=";
const TENANT_ID = "u:user_39PRJcsC4dsC2EKtFcPEQq35ttW";
const USER_ID = "user_39PRJcsC4dsC2EKtFcPEQq35ttW";
const PROXY_BASE_URL = "http://127.0.0.1:18317/v1";
const PROXY_API_KEY = "quotio-local-A880E354-F330-43A6-84C0-C96BB77E039A";

// ============================================================
// Token helpers
// ============================================================
function decryptTenantSecret(masterKeyBase64, tenantId, encoded) {
  const packed = Buffer.from(encoded, "base64url");
  const master = Buffer.from(masterKeyBase64, "base64");
  const key = createHmac("sha256", master).update(tenantId).digest().subarray(0, 32);
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(packed.length - 16);
  const encrypted = packed.subarray(12, packed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(c => c.text ?? c.content ?? "").join("");
  return JSON.stringify(content);
}

// ============================================================
// Load OAuth token from Postgres
// ============================================================
const pool = new pg.Pool({ connectionString: PG_URL });
const row = await pool.query(
  `SELECT token_enc FROM token_records WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`,
  [TENANT_ID, USER_ID, "openai"],
);
await pool.end();
const oauthToken = decryptTenantSecret(MASTER_KEY_B64, TENANT_ID, row.rows[0].token_enc);
console.log(`✓ OAuth token ready\n`);

// ============================================================
// Approach A: PiCodexChatModel
//
// Custom BaseChatModel that delegates directly to pi-ai's
// streamOpenAICodexResponses. pi-ai handles all Codex quirks:
//   - JWT → chatgpt-account-id extraction
//   - store:false, instructions, text verbosity
//   - Tool call format conversion
//   - SSE parsing + retry logic
// ============================================================

// Convert LangChain messages → pi-ai Context messages
function lcMessagesToPiContext(lcMessages) {
  let systemPrompt;
  const messages = [];

  for (const msg of lcMessages) {
    if (isSystemMessage(msg)) {
      systemPrompt = extractText(msg.content);
      continue;
    }

    if (isHumanMessage(msg)) {
      messages.push({ role: "user", content: extractText(msg.content), timestamp: Date.now() });
      continue;
    }

    if (isAIMessage(msg)) {
      const content = [];
      // Text content
      const text = extractText(msg.content);
      if (text) content.push({ type: "text", text });
      // Tool calls
      for (const tc of msg.tool_calls ?? []) {
        content.push({
          type: "toolCall",
          id: tc.id ?? `call_${tc.name}`,
          name: tc.name,
          arguments: tc.args ?? {},
        });
      }
      messages.push({ role: "assistant", content, api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.2", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
      continue;
    }

    if (isToolMessage(msg)) {
      messages.push({
        role: "toolResult",
        toolCallId: msg.tool_call_id,
        toolName: msg.name ?? "",
        content: [{ type: "text", text: extractText(msg.content) }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }

  return { systemPrompt, messages };
}

// Convert bound LangChain tools → pi-ai Tool[]
function lcToolsToPiTools(lcTools) {
  if (!lcTools?.length) return undefined;
  return lcTools.map((t) => {
    const openAITool = convertToOpenAITool(t);
    return {
      name: openAITool.function.name,
      description: openAITool.function.description ?? "",
      parameters: openAITool.function.parameters,
    };
  });
}

class PiCodexChatModel extends BaseChatModel {
  constructor({ model = "gpt-5.2", instructions, getToken } = {}) {
    super({});
    this._model = model;
    this._instructions = instructions ?? "You are a helpful assistant.";
    this._getToken = getToken ?? (() => Promise.resolve(oauthToken));
    this._boundTools = null;
  }

  _llmType() { return "pi-codex"; }

  // Support .bindTools() — LangGraph calls this to attach tools
  bindTools(tools, kwargs) {
    const bound = new PiCodexChatModel({
      model: this._model,
      instructions: this._instructions,
      getToken: this._getToken,
    });
    bound._boundTools = tools;
    return bound;
  }

  async _generate(messages, options) {
    const token = await this._getToken();
    const { systemPrompt, messages: piMessages } = lcMessagesToPiContext(messages);
    const piTools = lcToolsToPiTools(this._boundTools);

    const piModel = {
      id: this._model,
      name: this._model,
      api: "openai-codex-responses",
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    };

    const piContext = {
      systemPrompt: systemPrompt ?? this._instructions,
      messages: piMessages,
      ...(piTools ? { tools: piTools } : {}),
    };

    // Collect the streamed response (AssistantMessageEventStream is an async iterable)
    const stream = streamOpenAICodexResponses(piModel, piContext, { apiKey: token });

    let finalMessage = null;
    for await (const event of stream) {
      if (event.type === "done") { finalMessage = event.message; break; }
      if (event.type === "error") throw new Error(event.error?.errorMessage ?? "pi-ai error");
    }
    if (!finalMessage) throw new Error("No response from pi-ai");

    const textParts = finalMessage.content.filter(c => c.type === "text");
    const toolCallParts = finalMessage.content.filter(c => c.type === "toolCall");
    const text = textParts.map(c => c.text).join("");
    const toolCalls = toolCallParts.map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.arguments,
      type: "tool_call",
    }));

    const aiMsg = toolCalls.length > 0
      ? new AIMessage({ content: text || "", tool_calls: toolCalls })
      : new AIMessage({ content: text });

    return { generations: [{ message: aiMsg, text }] };
  }
}

// ============================================================
// Approach B: Local Quotio proxy — plain vanilla ChatOpenAI
// ============================================================
function makeProxyChatModel() {
  return new ChatOpenAI({
    model: "gpt-5.2",
    configuration: { apiKey: PROXY_API_KEY, baseURL: PROXY_BASE_URL },
    streaming: true,
  });
}

// ============================================================
// Shared tools
// ============================================================
const calculatorTool = tool(
  async ({ expression }) => {
    try { return `${expression} = ${Function(`"use strict"; return (${expression})`)()}`; }
    catch { return `Could not evaluate: ${expression}`; }
  },
  {
    name: "calculator",
    description: "Evaluate a simple math expression like '12 * 7'.",
    schema: z.object({ expression: z.string() }),
  }
);

const reverseStringTool = tool(
  async ({ text }) => text.split("").reverse().join(""),
  {
    name: "reverse_string",
    description: "Reverse the characters of a string.",
    schema: z.object({ text: z.string() }),
  }
);

const tools = [calculatorTool, reverseStringTool];
const toolNode = new ToolNode(tools);

// ============================================================
// Graph 1 (quickstart): single chat node, multi-turn
// ============================================================
function buildChatGraph(llm) {
  return new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({ messages: [await llm.invoke(state.messages)] }))
    .addEdge("__start__", "agent")
    .addEdge("agent", "__end__")
    .compile();
}

// ============================================================
// Graph 2 (quickstart): ReAct agent with tool calling
// ============================================================
function buildReActGraph(llm) {
  const modelWithTools = llm.bindTools(tools);

  function shouldContinue({ messages }) {
    const last = messages[messages.length - 1];
    if (isAIMessage(last) && last.tool_calls?.length) return "tools";
    return "__end__";
  }

  return new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({ messages: [await modelWithTools.invoke(state.messages)] }))
    .addNode("tools", toolNode)
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue, { tools: "tools", __end__: "__end__" })
    .addEdge("tools", "agent")
    .compile();
}

// ============================================================
// Run all tests
// ============================================================
async function runTests(label, llm) {
  console.log(`${"=".repeat(60)}`);
  console.log(label);
  console.log(`${"=".repeat(60)}`);

  console.log("\n[Graph 1] Multi-turn chatbot (quickstart pattern)");
  try {
    const graph = buildChatGraph(llm);
    const t1 = await graph.invoke({ messages: [new HumanMessage("My name is Alex. Say hello in exactly 5 words.")] });
    console.log(`  Turn 1 → ${extractText(t1.messages.at(-1).content)}`);
    const t2 = await graph.invoke({ messages: [...t1.messages, new HumanMessage("What is my name? One sentence.")] });
    console.log(`  Turn 2 → ${extractText(t2.messages.at(-1).content)}`);
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
  }

  console.log("\n[Graph 2] ReAct agent with calculator + reverse_string tools");
  try {
    const graph = buildReActGraph(llm);
    const r1 = await graph.invoke({ messages: [new HumanMessage("What is 347 * 28? Use the calculator tool.")] });
    console.log(`  Math   → ${extractText(r1.messages.at(-1).content)}`);
    const r2 = await graph.invoke({ messages: [new HumanMessage("Reverse the string 'LangGraph'. Use the reverse_string tool.")] });
    console.log(`  String → ${extractText(r2.messages.at(-1).content)}`);
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
  }

  console.log();
}

await runTests(
  "APPROACH A — PiCodexChatModel (pi-ai → chatgpt.com/backend-api/codex)",
  new PiCodexChatModel({ instructions: "You are a helpful assistant. Be concise." })
);

await runTests(
  "APPROACH B — Local Quotio proxy (http://127.0.0.1:18317/v1)",
  makeProxyChatModel()
);

console.log("Done.");
