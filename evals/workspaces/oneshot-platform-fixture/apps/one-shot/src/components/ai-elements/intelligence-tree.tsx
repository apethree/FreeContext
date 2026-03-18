import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MODE_CONFIG, MODE_ORDER } from "@/features/app/modeConfig";
import type { AppMode } from "@/features/app/types";

type AgentStatus = "active" | "idle";

type SubAgent = {
  label: string;
};

type AgentNode = {
  mode: AppMode;
  label: string;
  status: AgentStatus;
  sessions: number;
  subAgents: SubAgent[];
};

function buildAgentNodes(): AgentNode[] {
  return MODE_ORDER.map((mode) => {
    const config = MODE_CONFIG[mode];
    return {
      mode,
      label: `${config.label} Agent`,
      status: config.navItems.length > 0 ? "active" : "idle",
      sessions: config.navItems.length > 0 ? config.navItems.length : 0,
      subAgents: config.navItems.map((item) => ({ label: item.label })),
    };
  });
}

export function IntelligenceTree() {
  const agents = buildAgentNodes();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    work: true,
  });

  function toggleExpand(mode: string) {
    setExpanded((prev) => ({ ...prev, [mode]: !prev[mode] }));
  }

  return (
    <div className="font-mono text-xs text-muted-foreground">
      <div className="mb-2 font-semibold text-foreground">One Shot</div>
      <div className="space-y-0.5">
        {agents.map((agent, agentIdx) => {
          const isLast = agentIdx === agents.length - 1;
          const isOpen = expanded[agent.mode] && agent.subAgents.length > 0;
          const hasChildren = agent.subAgents.length > 0;
          const connector = isLast ? "└─" : "├─";

          return (
            <div key={agent.mode}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/50"
                onClick={() => hasChildren && toggleExpand(agent.mode)}
              >
                <span className="text-muted-foreground/50">{connector}</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      agent.status === "active"
                        ? `hsl(${MODE_CONFIG[agent.mode].color})`
                        : "hsl(var(--muted-foreground) / 0.3)",
                  }}
                />
                <span className="text-foreground">{agent.label}</span>
                <span className="text-muted-foreground/60">
                  [{agent.status}]
                </span>
                {agent.sessions > 0 ? (
                  <span className="text-muted-foreground/50">
                    {agent.sessions} tools
                  </span>
                ) : null}
                {hasChildren ? (
                  <span className="ml-auto text-muted-foreground/40">
                    {isOpen ? "▾" : "▸"}
                  </span>
                ) : null}
              </button>

              <AnimatePresence>
                {isOpen ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {agent.subAgents.map((sub, subIdx) => {
                      const subIsLast =
                        subIdx === agent.subAgents.length - 1;
                      const subConnector = subIsLast ? "└─" : "├─";
                      const treeLine = isLast ? "   " : "│  ";
                      return (
                        <div
                          key={sub.label}
                          className="flex items-center gap-2 py-0.5 pl-1"
                        >
                          <span className="text-muted-foreground/30">
                            {treeLine}
                            {subConnector}
                          </span>
                          <span>{sub.label}</span>
                        </div>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
