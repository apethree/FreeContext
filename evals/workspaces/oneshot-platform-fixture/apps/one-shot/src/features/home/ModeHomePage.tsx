import { useParams } from "react-router-dom";
import { PageContentContainer } from "@/features/app/PageContentContainer";
import { ChatsModePage } from "@/features/chats/ChatsModePage";
import { ChatsInboxPage } from "@/features/chats/ChatsInboxPage";
import { ChatsManageChannelsPage } from "@/features/chats/ChatsManageChannelsPage";
import { MailConnectPage } from "@/features/mail/MailConnectPage";
import { MailInboxPage } from "@/features/mail/MailInboxPage";
import { MailModePage } from "@/features/mail/MailModePage";
import { MODE_CONFIG } from "@/features/app/modeConfig";
import { WorkModeMockPage } from "@/features/home/WorkModeMockPage";
import { modeIcon } from "@/features/sidebar/ModeSwitcher";
import type { AppMode } from "@/features/app/types";

function normalizeMode(raw?: string): AppMode {
  if (
    raw === "work" ||
    raw === "finance" ||
    raw === "social" ||
    raw === "health" ||
    raw === "chats" ||
    raw === "mail"
  ) {
    return raw;
  }
  if (raw === "logistics") return "social";
  if (raw === "communication") return "chats";
  return "work";
}

const MODE_SUBTITLE: Record<AppMode, string> = {
  work: "Design, run, and monitor execution workflows with intelligent copilots.",
  finance: "Track spend, cash flow, and risk with practical agent-driven insights.",
  social: "Coordinate social streams, creators, and campaign execution in one view.",
  health: "Organize wellness tasks and alerts in one focused operational view.",
  chats: "Manage conversations, handoffs, and outbound messaging quality.",
  mail: "Run all connected inboxes and agent-managed mail workflows from one focused workspace.",
};

const MODE_METRICS: Record<
  AppMode,
  Array<{ label: string; value: string; note: string }>
> = {
  work: [
    { label: "Active runs", value: "3", note: "2 running, 1 pending input" },
    { label: "Automation health", value: "94%", note: "No critical blockers" },
    { label: "Pending reviews", value: "5", note: "Design + QA checks queued" },
  ],
  finance: [
    { label: "Budget status", value: "On track", note: "Forecast variance +2.1%" },
    { label: "Transactions", value: "142", note: "Last 7 days" },
    { label: "Alerts", value: "2", note: "Threshold reminders only" },
  ],
  social: [
    { label: "Active campaigns", value: "6", note: "2 drafting, 4 scheduled" },
    { label: "Queue health", value: "98%", note: "No blocked publications" },
    { label: "Mentions", value: "41", note: "Across connected channels" },
  ],
  health: [
    { label: "Daily goals", value: "4 / 5", note: "One reminder pending" },
    { label: "Signals", value: "Stable", note: "No anomalies detected" },
    { label: "Habits", value: "82%", note: "This week completion rate" },
  ],
  chats: [
    { label: "Open threads", value: "26", note: "9 require response" },
    { label: "Response SLA", value: "91%", note: "Last 24h average" },
    { label: "Drafts pending", value: "7", note: "AI prepared for review" },
  ],
  mail: [
    { label: "Connected inboxes", value: "3", note: "Across CapZero + external providers" },
    { label: "Unread triage", value: "35", note: "Auto-prioritized by agent" },
    { label: "Approval queue", value: "6", note: "Ready for one-tap send" },
  ],
};

export function ModeHomePage() {
  const { mode, tab } = useParams();
  const normalizedMode = normalizeMode(mode);
  const config = MODE_CONFIG[normalizedMode];

  if (normalizedMode === "work") {
    return (
      <PageContentContainer className="max-w-none gap-3 px-1 pb-1 pt-0">
        <WorkModeMockPage />
      </PageContentContainer>
    );
  }

  if (normalizedMode === "chats") {
    const isInbox = tab === "inbox";
    const isManageChannels = tab === "manage-channels";
    return (
      <PageContentContainer className="max-w-none gap-3 px-1 pb-1 pt-0">
        {isInbox ? (
          <ChatsInboxPage />
        ) : isManageChannels ? (
          <ChatsManageChannelsPage />
        ) : (
          <ChatsModePage />
        )}
      </PageContentContainer>
    );
  }

  if (normalizedMode === "mail") {
    const isInbox = tab === "inbox";
    const isConnectMail = tab === "connect-mail";
    return (
      <PageContentContainer className="max-w-none gap-3 px-1 pb-1 pt-0">
        {isInbox ? (
          <MailInboxPage />
        ) : isConnectMail ? (
          <MailConnectPage />
        ) : (
          <MailModePage />
        )}
      </PageContentContainer>
    );
  }

  return (
    <PageContentContainer className="max-w-6xl gap-3">
      <section className="surface-raised px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/70">
            {(() => {
              const ModeIcon = modeIcon(normalizedMode);
              return <ModeIcon className="h-[17px] w-[17px] text-foreground/80" />;
            })()}
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Intelligence Mode
            </p>
            <h1 className="text-base font-semibold text-foreground">{config.label}</h1>
            <p className="max-w-2xl text-xs text-muted-foreground">
              {MODE_SUBTITLE[normalizedMode]}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {MODE_METRICS[normalizedMode].map((metric) => (
          <article key={metric.label} className="surface-raised px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{metric.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{metric.note}</p>
          </article>
        ))}
      </section>

      <section className="surface-recessed">
        <div className="surface-raised px-4 py-4">
          <p className="text-sm font-medium text-foreground">Mode workspace scaffolding</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This mode keeps the same practical shell structure as Work. We can wire
            domain-specific modules and data next while preserving consistent visual language.
          </p>
        </div>
      </section>
    </PageContentContainer>
  );
}
