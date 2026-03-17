export type AgentClient = "claude-code" | "cursor" | "codex" | "gemini-cli" | "opencode";
export type ScoutProvider = "anthropic" | "openai" | "openrouter";

export interface AgentSetupOptions {
  host: string;
  port: number;
  projectPath: string;
  scoutProvider?: ScoutProvider;
  scoutModel?: string;
}

export interface RecommendedMcp {
  name: string;
  category: "core" | "recommended" | "optional";
  purpose: string;
  note: string;
}

export interface AgentSetupPlan {
  client: AgentClient;
  endpoint: string;
  projectPath: string;
  startCommand: string;
  verifyHint: string;
  setupText: string;
  recommendedMcps: RecommendedMcp[];
  scoutText?: string;
}

const RECOMMENDED_MCPS: RecommendedMcp[] = [
  {
    name: "free-context",
    category: "core",
    purpose: "Local symbol, path, graph, and codebase retrieval for the current repo.",
    note: "This is the primary code-intel MCP."
  },
  {
    name: "context7",
    category: "recommended",
    purpose: "Up-to-date framework and library documentation lookup.",
    note: "Best companion MCP for API and docs questions."
  },
  {
    name: "playwright",
    category: "recommended",
    purpose: "Browser automation, screenshots, and interactive UI verification.",
    note: "Use for web apps and anything requiring real browser checks."
  },
  {
    name: "github",
    category: "optional",
    purpose: "Issues, pull requests, and repository-hosting workflow.",
    note: "Useful when the coding agent also needs repo hosting context."
  },
  {
    name: "web-search",
    category: "optional",
    purpose: "General web search and external research.",
    note: "Only add if the client does not already have a strong built-in web tool."
  }
];

export function createAgentSetupPlan(
  client: AgentClient,
  options: AgentSetupOptions
): AgentSetupPlan {
  const endpoint = `http://${options.host}:${options.port}/mcp`;
  const startCommand = `free-context serve ${options.projectPath} --storage lancedb --port ${options.port} --host ${options.host}`;

  return {
    client,
    endpoint,
    projectPath: options.projectPath,
    startCommand,
    verifyHint: verifyHintForClient(client),
    setupText: renderClientSetup(client, endpoint),
    recommendedMcps: RECOMMENDED_MCPS,
    scoutText: options.scoutProvider
      ? renderScoutSetup(options.scoutProvider, options.scoutModel)
      : undefined,
  };
}

function renderClientSetup(client: AgentClient, endpoint: string): string {
  switch (client) {
    case "claude-code":
      return [
        "Run this in your shell:",
        `claude mcp add --transport http --scope user free-context ${endpoint}`,
      ].join("\n");
    case "cursor":
      return [
        "Put this in `~/.cursor/mcp.json` or `.cursor/mcp.json`:",
        "",
        JSON.stringify(
          {
            mcpServers: {
              "free-context": {
                url: endpoint,
              },
            },
          },
          null,
          2
        ),
      ].join("\n");
    case "codex":
      return [
        "Use either the CLI command or the TOML block below.",
        "",
        `codex mcp add free-context --url ${endpoint}`,
        "",
        "[mcp_servers.free-context]",
        `url = "${endpoint}"`,
      ].join("\n");
    case "gemini-cli":
      return [
        "Put this in `~/.gemini/settings.json` or `.gemini/settings.json`:",
        "",
        JSON.stringify(
          {
            mcpServers: {
              "free-context": {
                httpUrl: endpoint,
              },
            },
          },
          null,
          2
        ),
      ].join("\n");
    case "opencode":
      return [
        "Put this in `~/.config/opencode/opencode.json` or `opencode.json`:",
        "",
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            mcp: {
              "free-context": {
                type: "remote",
                url: endpoint,
                enabled: true,
              },
            },
          },
          null,
          2
        ),
      ].join("\n");
  }
}

function verifyHintForClient(client: AgentClient): string {
  switch (client) {
    case "claude-code":
      return "Run `claude mcp list` or check `/mcp` inside Claude Code.";
    case "cursor":
      return "Open Cursor settings or restart the client and verify `free-context` appears in MCP tools.";
    case "codex":
      return "Run `codex mcp list`.";
    case "gemini-cli":
      return "Restart Gemini CLI and verify the MCP server appears in its configured tools.";
    case "opencode":
      return "Restart OpenCode and verify the MCP server appears in the MCP tool list.";
  }
}

function renderScoutSetup(provider: ScoutProvider, model?: string): string {
  const providerVar =
    provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : provider === "openai"
        ? "OPENAI_API_KEY"
        : "OPENROUTER_API_KEY";
  const scoutModel = model ?? defaultScoutModel(provider);

  return [
    "Scout agent API template:",
    `export ${providerVar}=<your-api-key>`,
    `export FREE_CONTEXT_SCOUT_PROVIDER=${provider}`,
    `export FREE_CONTEXT_SCOUT_MODEL=${scoutModel}`,
    "Use the scout model for summarization, context packet assembly, cheap repo scouting, and test-log triage.",
  ].join("\n");
}

function defaultScoutModel(provider: ScoutProvider): string {
  switch (provider) {
    case "anthropic":
      return "cheap-haiku-tier";
    case "openai":
      return "cheap-mini-tier";
    case "openrouter":
      return "qwen/qwen3-coder:free";
  }
}
