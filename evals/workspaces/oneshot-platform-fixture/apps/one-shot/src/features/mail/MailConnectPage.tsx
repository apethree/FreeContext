import { useMemo } from "react";
import {
  CircleUserRound,
  Message01Icon,
  MonitorCog,
  ServerStackIcon,
  Settings2,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { MAIL_CONNECTORS, type MailConnector } from "@/features/mail/mailCatalog";

function connectorIcon(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized.includes("capzero")) return Settings2;
  if (normalized.includes("gmail")) return Message01Icon;
  if (normalized.includes("outlook")) return MonitorCog;
  if (normalized.includes("icloud")) return CircleUserRound;
  return ServerStackIcon;
}

function connectorButton(connector: MailConnector) {
  if (connector.id === "capzero") return "Configure";
  return connector.connected ? "Reconnect" : "Connect";
}

export function MailConnectPage() {
  const sortedConnectors = useMemo(() => {
    return [...MAIL_CONNECTORS].sort((a, b) => {
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      if (a.connected && !b.connected) return -1;
      if (!a.connected && b.connected) return 1;
      return a.provider.localeCompare(b.provider);
    });
  }, []);

  return (
    <section className="workspace-shell">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:px-4">
        <header>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Connect Mail</p>
          <h1 className="text-base font-semibold text-foreground">Choose where your mail should live</h1>
          <p className="text-xs text-muted-foreground">
            Keep it simple: connect your current providers or move to CapZero Mail for an agent-managed workflow.
          </p>
        </header>

        <section className="workspace-summary-card border-sky-400/35 bg-[linear-gradient(140deg,hsl(var(--mode-mail)/0.2),hsl(var(--mode-mail)/0.06)_56%,hsl(var(--workspace-surface-1)))]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/80">
                <HugeiconsIcon icon={Settings2} className="h-3.5 w-3.5" />
                Recommended
              </p>
              <h2 className="mt-0.5 text-sm font-semibold text-foreground">CapZero Mail</h2>
              <p className="mt-0.5 max-w-xl text-xs text-foreground/80">
                Create a clean <code>@capzero.com</code> identity where your assistant triages, drafts, and sends with approval guardrails.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/75">
                <span className="workspace-tag border-border/45 bg-background/50">Private by default</span>
                <span className="workspace-tag border-border/45 bg-background/50">Approval-first sends</span>
                <span className="workspace-tag border-border/45 bg-background/50">Unified thread memory</span>
              </div>
            </div>
            <Button type="button" className="h-8 rounded-lg px-3 text-xs">
              Use CapZero Mail
              <span className="ml-1" aria-hidden="true">{">"}</span>
            </Button>
          </div>
        </section>

        <section className="min-h-0 flex-1">
          <div className="workspace-section-title px-1 pb-1">
            <span>Mail connectors</span>
            <span className="workspace-tag">{sortedConnectors.length}</span>
          </div>

          <div className="workspace-scroll min-h-0 space-y-2 pr-1">
            {sortedConnectors.map((connector) => {
              const Icon = connectorIcon(connector.provider);
              return (
                <article key={connector.id} className="workspace-action-row items-start rounded-xl p-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/70 text-muted-foreground">
                    <HugeiconsIcon icon={Icon} className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold text-foreground">{connector.provider}</p>
                      {connector.recommended ? (
                        <span className="workspace-tag border-sky-500/35 text-sky-600 dark:text-sky-400">Recommended</span>
                      ) : null}
                      {connector.connected ? (
                        <span className="workspace-tag border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Connected</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-foreground/85">{connector.description}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{connector.hint}</p>
                  </div>

                  <div className="shrink-0">
                    <Button
                      type="button"
                      variant={connector.connected || connector.id === "capzero" ? "default" : "outline"}
                      className="h-8 rounded-lg px-3 text-xs"
                    >
                      {connectorButton(connector)}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="workspace-action-row rounded-xl border-dashed p-3 text-xs text-muted-foreground">
          <HugeiconsIcon icon={Message01Icon} className="h-4 w-4 text-emerald-500" />
          We will wire live OAuth and mailbox provisioning in the next backend phase; this UI is ready for that integration.
        </section>
      </div>
    </section>
  );
}
