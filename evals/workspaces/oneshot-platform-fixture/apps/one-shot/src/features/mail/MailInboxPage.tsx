import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleUserRound,
  Message01Icon,
  MonitorCog,
  ServerStackIcon,
  Settings2,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import {
  CONNECTED_MAILBOXES,
  type ConnectedMailbox,
} from "@/features/mail/mailCatalog";

function mailboxIcon(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized.includes("capzero")) return Settings2;
  if (normalized.includes("gmail")) return Message01Icon;
  if (normalized.includes("outlook")) return MonitorCog;
  if (normalized.includes("icloud")) return CircleUserRound;
  return ServerStackIcon;
}

function statusPill(status: ConnectedMailbox["status"]) {
  if (status === "connected") {
    return <span className="workspace-tag border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Connected</span>;
  }
  if (status === "syncing") {
    return <span className="workspace-tag border-amber-500/30 text-amber-600 dark:text-amber-400">Syncing</span>;
  }
  return <span className="workspace-tag border-red-500/30 text-red-600 dark:text-red-400">Needs Attention</span>;
}

export function MailInboxPage() {
  const navigate = useNavigate();

  const totals = useMemo(() => {
    return CONNECTED_MAILBOXES.reduce(
      (acc, mailbox) => {
        acc.unread += mailbox.unread;
        acc.pending += mailbox.pendingApprovals;
        return acc;
      },
      { unread: 0, pending: 0 },
    );
  }, []);

  return (
    <section className="workspace-shell">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:px-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Mail Inbox</p>
            <h1 className="text-base font-semibold text-foreground">All connected mail in one clean view</h1>
            <p className="text-xs text-muted-foreground">
              Your assistant triages inboxes, drafts replies, and asks for approval only when needed.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={() => navigate("/home/mode/mail/connect-mail")}
          >
            Connect Mail
          </Button>
        </header>

        <button
          type="button"
          className="workspace-action-row group relative items-start overflow-hidden rounded-xl border border-sky-400/35 bg-[linear-gradient(135deg,hsl(var(--mode-mail)/0.18),hsl(var(--mode-mail)/0.06)_52%,hsl(var(--workspace-surface-2)))] p-3"
          onClick={() => navigate("/home/mode/mail/connect-mail")}
        >
          <span className="workspace-sparkle mt-0.5"><HugeiconsIcon icon={Settings2} className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Set up CapZero Mail</p>
            <p className="mt-0.5 text-xs text-foreground/80">
              Launch a private <code>@capzero.com</code> mailbox where your agent handles routing, triage, and follow-up.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/85 transition-transform duration-150 group-hover:translate-x-0.5">
            Configure
            <span aria-hidden="true">{">"}</span>
          </span>
        </button>

        <section className="grid gap-2 sm:grid-cols-2">
          <article className="workspace-summary-card">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Unread</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{totals.unread}</p>
            <p className="text-[11px] text-muted-foreground">Across all connected providers</p>
          </article>
          <article className="workspace-summary-card">
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Approvals</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{totals.pending}</p>
            <p className="text-[11px] text-muted-foreground">Agent drafts waiting for confirmation</p>
          </article>
        </section>

        <section className="min-h-0 flex-1">
          <div className="workspace-section-title px-1 pb-1">
            <span>Connected mailboxes</span>
            <span className="workspace-tag">{CONNECTED_MAILBOXES.length}</span>
          </div>

          <div className="workspace-scroll min-h-0 space-y-2 pr-1">
            {CONNECTED_MAILBOXES.map((mailbox) => {
              const Icon = mailboxIcon(mailbox.provider);
              return (
                <article key={mailbox.id} className="workspace-action-row items-start rounded-xl p-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/70 text-muted-foreground">
                    <HugeiconsIcon icon={Icon} className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold text-foreground">{mailbox.displayName}</p>
                      {statusPill(mailbox.status)}
                    </div>
                    <p className="truncate text-xs text-foreground/85">{mailbox.address}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{mailbox.provider} · {mailbox.lastSyncLabel}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                    <span className="text-xs font-medium text-foreground">{mailbox.unread} unread</span>
                    <span className="text-[11px] text-muted-foreground">{mailbox.pendingApprovals} pending</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-lg px-2 text-[11px]"
                    >
                      <HugeiconsIcon icon={Message01Icon} className="mr-1 h-3.5 w-3.5" />
                      Open
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
