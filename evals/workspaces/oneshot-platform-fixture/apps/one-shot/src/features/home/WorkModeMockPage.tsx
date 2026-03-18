import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  AiBookIcon,
  ArrowRight01Icon,
  BellRing,
  CircleUserRound,
  CreditCard,
  FlowConnectionIcon,
  FolderOpen,
  ListFilter,
  Message01Icon,
  ServerStackIcon,
  Settings2,
  SparklesIcon,
  SquarePen,
} from "@hugeicons/core-free-icons";

const WORKFLOWS = ["default-agent", "Mail thing", "what"];
const BLOCKS = [
  "Agent",
  "API",
  "Condition",
  "Function",
  "Router",
  "Memory",
  "Knowledge",
  "Workflow",
];

const SETTINGS_NAV = ["Templates", "Knowledge Base", "Logs", "Settings"];

export function WorkModeMockPage() {
  return (
    <section className="workspace-shell">
      <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0">
        <ResizablePanel defaultSize="24%" minSize="18%" maxSize="32%" className="min-w-0 overflow-hidden">
          <aside className="workspace-pane">
            <div className="workspace-search">
              <HugeiconsIcon icon={ListFilter} className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[12px] text-muted-foreground">Search</span>
              <span className="ml-auto rounded border border-border/60 px-1.5 py-0 text-[10px] text-muted-foreground">
                K
              </span>
            </div>

            <article className="workspace-card p-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="workspace-pane-kicker">Workflows</p>
                <button type="button" className="workspace-icon-btn h-5 w-5">
                  <HugeiconsIcon icon={SquarePen} className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                {WORKFLOWS.map((workflow, idx) => (
                  <button
                    key={workflow}
                    type="button"
                    className={`workspace-workflow-row ${idx === 2 ? "workspace-workflow-row-active" : ""}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--mode-work))]" />
                    <span className="truncate">{workflow}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="workspace-card p-2">
              <div className="mb-2 inline-flex rounded-md border border-border/50 bg-background/70 p-0.5">
                <button type="button" className="workspace-segment-active">
                  Blocks
                </button>
                <button type="button" className="workspace-segment-idle">
                  Triggers
                </button>
              </div>
              <div className="workspace-scroll pr-0.5">
                {BLOCKS.map((block) => (
                  <button key={block} type="button" className="workspace-block-row">
                    <HugeiconsIcon icon={AiBookIcon} className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{block}</span>
                  </button>
                ))}
              </div>
            </article>

            <div className="mt-auto space-y-1">
              {SETTINGS_NAV.map((item) => (
                <button key={item} type="button" className="workspace-bottom-nav-row">
                  <HugeiconsIcon icon={FolderOpen} className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{item}</span>
                </button>
              ))}
            </div>
          </aside>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20 bg-border/80" />

        <ResizablePanel defaultSize="52%" minSize="38%" className="min-w-0 overflow-hidden">
          <main className="workspace-canvas">
            <header className="workspace-canvas-topbar">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">
                  Work · Landing Page Analysis
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Flow editor and execution console
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="workspace-pill-btn">
                  Deploy
                </button>
                <button type="button" className="workspace-pill-btn workspace-pill-btn-primary">
                  Run
                </button>
              </div>
            </header>

            <div className="workspace-editor-area">
              <div className="workspace-node workspace-node-start" style={{ top: 44, left: 74 }}>
                <span className="workspace-node-dot bg-sky-500" />
                <span>Start</span>
              </div>

              <div className="workspace-node" style={{ top: 168, left: 76 }}>
                <span className="workspace-node-dot bg-violet-500" />
                <div>
                  <p className="text-[12px] font-medium text-foreground">Agent</p>
                  <p className="text-[10px] text-muted-foreground">gpt-4o · 3 tools</p>
                </div>
              </div>

              <div className="workspace-node" style={{ top: 334, left: 368 }}>
                <span className="workspace-node-dot bg-rose-500" />
                <div>
                  <p className="text-[12px] font-medium text-foreground">Gmail</p>
                  <p className="text-[10px] text-muted-foreground">Search messages · limit 10</p>
                </div>
              </div>

              <div className="workspace-connector workspace-connector-a" />
              <div className="workspace-connector workspace-connector-b" />

              <div className="workspace-floating-toolbar">
                <button type="button" className="workspace-icon-btn">
                  <HugeiconsIcon icon={FolderOpen} className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="workspace-icon-btn">
                  <HugeiconsIcon icon={Message01Icon} className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="workspace-icon-btn">
                  <HugeiconsIcon icon={FlowConnectionIcon} className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="workspace-icon-btn">
                  <HugeiconsIcon icon={Settings2} className="h-3.5 w-3.5" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-border/70" />
                <button type="button" className="workspace-pill-btn">
                  Deploy
                </button>
                <button type="button" className="workspace-pill-btn workspace-pill-btn-primary">
                  Run
                </button>
              </div>
            </div>

            <section className="workspace-console">
              <div className="workspace-console-header">
                <p className="text-[12px] font-medium text-foreground">Console</p>
                <button type="button" className="workspace-icon-btn">
                  <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
                </button>
              </div>
              <pre className="workspace-console-output">{`{
  content: "Hello! How can I assist you today?",
  model: "gpt-4o",
  tokens: { prompt: 0, completion: 0, total: 0 },
  providerTiming: { duration: 373 }
}`}</pre>
            </section>
          </main>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20 bg-border/80" />

        <ResizablePanel defaultSize="24%" minSize="18%" maxSize="32%" className="min-w-0 overflow-hidden">
          <aside className="workspace-pane">
            <div className="workspace-pane-header">
              <div className="inline-flex rounded-md border border-border/50 bg-background/70 p-0.5">
                <button type="button" className="workspace-segment-active">
                  Design
                </button>
                <button type="button" className="workspace-segment-idle">
                  Copilot
                </button>
              </div>
              <button type="button" className="workspace-icon-btn">
                <HugeiconsIcon icon={SparklesIcon} className="h-3.5 w-3.5" />
              </button>
            </div>

            <article className="workspace-card">
              <div className="flex items-start gap-2">
                <span className="workspace-node-dot bg-violet-500 mt-1" />
                <div>
                  <p className="text-[12px] font-medium text-foreground">Agent</p>
                  <p className="text-[11px] text-muted-foreground">Copywriter agent, uses gpt-4o</p>
                </div>
              </div>
            </article>

            <section className="workspace-inspector-section">
              <p className="workspace-pane-kicker">Variables</p>
              <div className="workspace-input-row">6+ variables</div>
            </section>

            <section className="workspace-inspector-section">
              <p className="workspace-pane-kicker">Model</p>
              <div className="workspace-input-row">GPT-4o</div>
            </section>

            <section className="workspace-inspector-section">
              <p className="workspace-pane-kicker">System Prompt</p>
              <div className="workspace-textarea">
                You are a seasoned copywriter and technical communication expert. Review
                style, audience, and impact in one concise pass.
              </div>
            </section>

            <section className="workspace-inspector-section">
              <p className="workspace-pane-kicker">Tools</p>
              <div className="workspace-input-row">Add tools</div>
            </section>

            <section className="workspace-inspector-section">
              <p className="workspace-pane-kicker">Temperature</p>
              <div className="workspace-slider">
                <div className="workspace-slider-track" />
                <div className="workspace-slider-thumb" />
              </div>
            </section>

            <section className="workspace-inspector-section mt-auto">
              <p className="workspace-pane-kicker">Status</p>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="workspace-mini-card">
                  <HugeiconsIcon icon={CreditCard} className="h-3.5 w-3.5" />
                  <span>Cost</span>
                </div>
                <div className="workspace-mini-card">
                  <HugeiconsIcon icon={ServerStackIcon} className="h-3.5 w-3.5" />
                  <span>Infra</span>
                </div>
                <div className="workspace-mini-card">
                  <HugeiconsIcon icon={BellRing} className="h-3.5 w-3.5" />
                  <span>Alerts</span>
                </div>
              </div>
            </section>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
