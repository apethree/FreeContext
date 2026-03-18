import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity01Icon,
  BotMessageSquare,
  Cancel01Icon,
  Clock03Icon,
  Message01Icon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAppShellContext } from "@/features/app/AppShellContext";
import { useChannels } from "@/shared/hooks/useChannels";

type Escalation = {
  id: string;
  contact: string;
  channel: string;
  reason: string;
  suggestion: string;
  status: "pending" | "approved" | "denied";
};

const INITIAL_ESCALATIONS: Escalation[] = [
  {
    id: "esc-1",
    contact: "Alex Chen",
    channel: "WhatsApp",
    reason: "Potential conflict with existing calendar hold at 7:15 PM.",
    suggestion: "Yes, we are on for 7 PM. I will share ETA at 6:30.",
    status: "pending",
  },
  {
    id: "esc-2",
    contact: "Ops Team",
    channel: "iMessage",
    reason: "Message includes outage language and requires review.",
    suggestion:
      "Confirmed. We can broadcast now with impact summary and 20-minute ETA for next update.",
    status: "pending",
  },
];

const SHORTCUTS = [
  "/contact NAME",
  "/contact-history NAME",
  "/channels",
  "/approve REQUEST_ID",
];

const EVENTS = [
  "Agent approved 2 replies in WhatsApp",
  "Slack support channel paused for QA",
  "Ops Team escalation waiting for review",
  "Alex Chen contact memory updated",
];

export function ChatsModePage() {
  const navigate = useNavigate();
  const { onOpenAssistantChat } = useAppShellContext();
  const channels = useChannels();
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState(
    "I can manage channels, summarize contacts, and handle approvals. Try /contact Alex Chen",
  );
  const [escalations, setEscalations] = useState<Escalation[]>(INITIAL_ESCALATIONS);

  const pendingEscalations = useMemo(
    () => escalations.filter((item) => item.status === "pending"),
    [escalations],
  );

  const setEscalationStatus = (id: string, status: Escalation["status"]) => {
    setEscalations((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
            }
          : item,
      ),
    );
  };

  const askAssistant = async () => {
    const prompt = assistantPrompt.trim();
    if (!prompt) return;

    if (prompt.startsWith("/contact ")) {
      const name = prompt.replace("/contact ", "").trim();
      setAssistantAnswer(
        `Loading ${name} context: full history, approvals, commitments, and channel mix in one summary.`,
      );
    } else if (prompt.startsWith("/contact-history ")) {
      const name = prompt.replace("/contact-history ", "").trim();
      setAssistantAnswer(
        `History query queued for ${name}. I will merge WhatsApp, iMessage, Telegram, Slack, and Discord touchpoints.`,
      );
    } else if (prompt.startsWith("/channels")) {
      const activeCount = channels.filter((item) => item.is_active !== false).length;
      const summary = channels.length === 0
        ? "No channels connected yet."
        : `${activeCount}/${channels.length} channels active.`;
      setAssistantAnswer(`${summary} Opening Manage Channels now.`);
      navigate(`/home/settings/${encodeURIComponent("Manage Channels")}`);
    } else {
      setAssistantAnswer(
        "Command received. I can handle approvals, summarize contacts, and manage channel operations.",
      );
    }

    setAssistantPrompt("");
  };

  return (
    <section className="workspace-shell">
      <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0">
        <ResizablePanel defaultSize="56%" minSize="44%" className="min-w-0 overflow-hidden">
          <main className="workspace-canvas min-w-0">
            <header className="workspace-canvas-topbar">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-foreground">
                  Assistant Command Console
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Ask to manage channels, approvals, and contact history
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="workspace-pill-btn" onClick={onOpenAssistantChat}>
                  Full assistant
                </button>
              </div>
            </header>

            <div className="workspace-canvas-body">
              <section className="workspace-summary-card">
                <div className="workspace-section-title">
                  <span>Assistant stream</span>
                  <span className="workspace-tag">Live</span>
                </div>
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <article className="workspace-message-ai">
                    <p className="workspace-message-title">Assistant</p>
                    <p className="workspace-message-body">
                      I can route replies, summarize contacts, and manage channel health across all connected messaging systems.
                    </p>
                  </article>
                  <article className="workspace-message-in">
                    <p className="workspace-message-title">You</p>
                    <p className="workspace-message-body">{assistantPrompt || "Try /contact Alex Chen"}</p>
                  </article>
                </div>
              </section>

              <section className="workspace-composer mt-3">
                <div className="workspace-aware-line">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Assistant is aware of all channel and contact context
                </div>
                <div className="workspace-composer-input mt-2">
                  <HugeiconsIcon icon={Message01Icon} className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={assistantPrompt}
                    onChange={(event) => setAssistantPrompt(event.target.value)}
                    placeholder="/contact NAME  /contact-history NAME  /channels"
                    className="h-7 border-none bg-transparent px-0 text-[11px] shadow-none focus-visible:ring-0"
                  />
                  <button type="button" className="workspace-send-btn" onClick={() => void askAssistant()}>
                    Ask
                  </button>
                </div>
                <div className="mt-2 rounded-md border border-border/45 bg-background/60 p-2">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    Assistant output
                  </p>
                  <p className="mt-1 text-[11px] text-foreground/90">{assistantAnswer}</p>
                </div>
              </section>

              <div className="workspace-divider mt-3">
                <span>Approval queue</span>
              </div>

              <section className="space-y-1.5">
                {pendingEscalations.map((item) => (
                  <article key={item.id} className="workspace-action-row items-start">
                    <HugeiconsIcon icon={Clock03Icon} className="mt-0.5 h-3.5 w-3.5 text-amber-500" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-[11px] font-medium text-foreground">
                        {item.contact} · {item.channel}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{item.reason}</p>
                      <p className="text-[11px] text-foreground/90">{item.suggestion}</p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <button
                        type="button"
                        className="workspace-icon-btn"
                        title="Approve"
                        onClick={() => setEscalationStatus(item.id, "approved")}
                      >
                        <HugeiconsIcon icon={TaskDone01Icon} className="h-3.5 w-3.5 text-emerald-500" />
                      </button>
                      <button
                        type="button"
                        className="workspace-icon-btn"
                        title="Deny"
                        onClick={() => setEscalationStatus(item.id, "denied")}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5 text-rose-500" />
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </div>
          </main>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20 bg-border/80" />

        <ResizablePanel defaultSize="44%" minSize="28%" className="min-w-0 overflow-hidden">
          <aside className="workspace-pane min-w-0">
            <article className="workspace-card">
              <div className="workspace-section-title">
                <span>Shortcut commands</span>
                <span className="workspace-tag">assistant</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {SHORTCUTS.map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="workspace-action-row"
                    onClick={() => setAssistantPrompt(command)}
                  >
                    <HugeiconsIcon icon={Message01Icon} className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{command}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="workspace-card min-h-0 flex-1">
              <div className="workspace-section-title">
                <span>Event flow</span>
                <span className="workspace-tag">real-time</span>
              </div>
              <div className="workspace-scroll mt-2 space-y-1.5">
                {EVENTS.map((event) => (
                  <div key={event} className="workspace-action-row">
                    <HugeiconsIcon icon={Activity01Icon} className="h-3.5 w-3.5 text-sky-500" />
                    <span className="text-[11px]">{event}</span>
                  </div>
                ))}
              </div>
            </article>

            <button type="button" className="workspace-action-row" onClick={onOpenAssistantChat}>
              <HugeiconsIcon icon={BotMessageSquare} className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">Open full chat assistant workspace</span>
            </button>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
