/**
 * Quick test: Call OpenAI with our OAuth token via both Vercel AI SDK and Mastra
 *
 * Key finding: Codex OAuth tokens hit ChatGPT's backend API, NOT the standard
 * OpenAI API. pi-ai uses:
 *   Base URL:  https://chatgpt.com/backend-api
 *   Endpoint:  /codex/responses
 *   Auth:      Bearer token + chatgpt-account-id header (extracted from JWT)
 *   Headers:   OpenAI-Beta: responses=experimental, originator: pi
 */
import { createDecipheriv, createHmac } from "node:crypto";
import pg from "pg";

// --- Config ---
const PG_URL = "postgres://narya@127.0.0.1:5432/capzero";
const MASTER_KEY_B64 = "t412w5D6+r6/S/urHKF8R4WNKmLJvLXCpTYyMpVcpBU=";
const TENANT_ID = "u:user_39PRJcsC4dsC2EKtFcPEQq35ttW";
const USER_ID = "user_39PRJcsC4dsC2EKtFcPEQq35ttW";
const PROVIDER = "openai";

// ChatGPT backend (what pi-ai uses for openai-codex provider)
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

// --- Decrypt helper (from token-crypto.ts) ---
function decryptTenantSecret(masterKeyBase64, tenantId, encoded) {
  const packed = Buffer.from(encoded, "base64url");
  const master = Buffer.from(masterKeyBase64, "base64");
  const key = createHmac("sha256", master).update(tenantId).digest().subarray(0, 32);
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(packed.length - 16);
  const encrypted = packed.subarray(12, packed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}

// --- Extract chatgpt-account-id from JWT (same as pi-ai) ---
function extractAccountId(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  // pi-ai looks at: payload["https://api.openai.com/auth"]?.chatgpt_account_id
  const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!accountId) throw new Error("No chatgpt_account_id in JWT");
  return accountId;
}

// --- Fetch token from Postgres ---
const pool = new pg.Pool({ connectionString: PG_URL });
const result = await pool.query(
  `SELECT token_enc FROM token_records WHERE tenant_id = $1 AND user_id = $2 AND provider = $3`,
  [TENANT_ID, USER_ID, PROVIDER],
);
await pool.end();

if (!result.rows[0]) {
  console.error("No token found!");
  process.exit(1);
}

const token = decryptTenantSecret(MASTER_KEY_B64, TENANT_ID, result.rows[0].token_enc);
console.log(`✓ Decrypted OpenAI token (first 20 chars): ${token.slice(0, 20)}...`);
console.log(`  Token length: ${token.length}`);

const accountId = extractAccountId(token);
console.log(`✓ Extracted chatgpt-account-id: ${accountId}`);
console.log();

// ============================================================
// TEST 0: Raw fetch to Codex endpoint (validate endpoint works)
// ============================================================
console.log("=== TEST 0: Raw fetch (Codex endpoint) ===");
try {
  const resp = await fetch(`${CODEX_BASE_URL}/codex/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "pi",
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      instructions: "You are a helpful assistant. Be very brief.",
      input: [{ role: "user", content: "Say hello in exactly 3 words." }],
      store: false,
      stream: true,
    }),
  });

  console.log(`  Status: ${resp.status} ${resp.statusText}`);
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`  Error body: ${body}`);
  } else {
    // Read SSE stream and extract text
    const text = await resp.text();
    const lines = text.split("\n").filter(l => l.startsWith("data: "));
    let fullText = "";
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "response.output_text.delta") {
          fullText += data.delta || "";
        }
        if (data.type === "response.completed" || data.type === "response.done") {
          const output = data.response?.output;
          if (output) {
            for (const item of output) {
              if (item.type === "message" && item.content) {
                for (const c of item.content) {
                  if (c.type === "output_text") fullText = c.text;
                }
              }
            }
          }
        }
      } catch {}
    }
    console.log(`✓ Response: ${fullText || "(stream parsed, check format)"}`);
  }
} catch (err) {
  console.error(`✗ Raw fetch error: ${err.message}`);
}

console.log();

// ============================================================
// TEST 1: Vercel AI SDK — using ChatGPT backend (Codex)
// ============================================================
console.log("=== TEST 1: Vercel AI SDK (Codex endpoint) ===");
try {
  const { streamText } = await import("ai");
  const { createOpenAI } = await import("@ai-sdk/openai");

  // Point at ChatGPT backend with required Codex headers
  const openai = createOpenAI({
    baseURL: `${CODEX_BASE_URL}/codex`,
    apiKey: token,
    headers: {
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "pi",
    },
  });

  // Codex endpoint requires: instructions (body field), store=false, stream=true
  // Use streamText (not generateText) since Codex requires stream=true
  const stream = streamText({
    model: openai("gpt-5.2"),
    prompt: "Say 'Hello from Vercel AI SDK' in exactly 5 words.",
    maxTokens: 50,
    providerOptions: {
      openai: {
        instructions: "You are a helpful assistant. Be very brief.",
        store: false,
      },
    },
  });

  const aiResult = await stream;
  const text = await aiResult.text;
  console.log(`✓ Response: ${text}`);
  console.log(`  Tokens: ${JSON.stringify(await aiResult.usage)}`);
} catch (err) {
  console.error(`✗ Vercel AI SDK error: ${err.message}`);
  if (err.responseBody) console.error(`  Body: ${err.responseBody}`);
  if (err.cause) console.error(`  Cause: ${err.cause}`);
}

console.log();

// ============================================================
// TEST 2: Mastra — using ChatGPT backend (Codex)
// ============================================================
console.log("=== TEST 2: Mastra (Codex endpoint) ===");
try {
  const { Agent } = await import("@mastra/core/agent");
  const { createOpenAI: createOpenAI2 } = await import("@ai-sdk/openai");

  const openai2 = createOpenAI2({
    baseURL: `${CODEX_BASE_URL}/codex`,
    apiKey: token,
    headers: {
      "chatgpt-account-id": accountId,
      "OpenAI-Beta": "responses=experimental",
      "originator": "pi",
    },
  });

  // Mastra Agent wraps Vercel AI SDK — use stream() to get streaming
  const agent = new Agent({
    name: "test-agent",
    instructions: "You are a helpful assistant. Be very brief.",
    model: openai2("gpt-5.2"),
  });

  // Use stream() and pass providerOptions for Codex requirements
  const mastraResult = await agent.stream("Say 'Hello from Mastra' in exactly 4 words.", {
    providerOptions: {
      openai: {
        instructions: "You are a helpful assistant. Be very brief.",
        store: false,
      },
    },
  });

  let text = "";
  for await (const chunk of mastraResult.textStream) {
    text += chunk;
  }
  console.log(`✓ Response: ${text}`);
} catch (err) {
  console.error(`✗ Mastra error: ${err.message}`);
  if (err.responseBody) console.error(`  Body: ${err.responseBody}`);
  if (err.cause) console.error(`  Cause: ${JSON.stringify(err.cause)}`);
  if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
}

console.log();
console.log("Done.");
