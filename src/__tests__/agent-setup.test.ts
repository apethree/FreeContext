import { describe, expect, it } from "vitest";
import { createAgentSetupPlan } from "../cli/agent-setup.js";

describe("createAgentSetupPlan", () => {
  it("renders a Claude Code setup command with the correct endpoint", () => {
    const plan = createAgentSetupPlan("claude-code", {
      host: "127.0.0.1",
      port: 3100,
      projectPath: ".",
    });

    expect(plan.endpoint).toBe("http://127.0.0.1:3100/mcp");
    expect(plan.setupText).toContain(
      "claude mcp add --transport http --scope user free-context http://127.0.0.1:3100/mcp"
    );
    expect(plan.verifyHint).toContain("claude mcp list");
  });

  it("renders a Codex setup with both CLI and TOML options", () => {
    const plan = createAgentSetupPlan("codex", {
      host: "127.0.0.1",
      port: 4100,
      projectPath: "/repo",
    });

    expect(plan.setupText).toContain("codex mcp add free-context --url http://127.0.0.1:4100/mcp");
    expect(plan.setupText).toContain("[mcp_servers.free-context]");
    expect(plan.setupText).toContain('url = "http://127.0.0.1:4100/mcp"');
  });

  it("includes a scout API template when a provider is requested", () => {
    const plan = createAgentSetupPlan("cursor", {
      host: "127.0.0.1",
      port: 3100,
      projectPath: ".",
      scoutProvider: "openrouter",
    });

    expect(plan.scoutText).toContain("OPENROUTER_API_KEY");
    expect(plan.scoutText).toContain("FREE_CONTEXT_SCOUT_PROVIDER=openrouter");
    expect(plan.scoutText).toContain("FREE_CONTEXT_SCOUT_MODEL=qwen/qwen3-coder:free");
  });
});
