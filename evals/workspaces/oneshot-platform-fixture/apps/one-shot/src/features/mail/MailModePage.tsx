import { useNavigate } from "react-router-dom";
import {
  Message01Icon,
  ServerStackIcon,
  Settings2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";

export function MailModePage() {
  const navigate = useNavigate();

  return (
    <section className="workspace-shell">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-3 px-3 py-3 sm:px-4">
        <header>
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Mail Mode</p>
          <h1 className="text-base font-semibold text-foreground">Agent-managed email without setup overload</h1>
          <p className="text-xs text-muted-foreground">
            Pick your next step. Inbox shows connected mailboxes. Connect Mail handles provider setup and CapZero Mail provisioning.
          </p>
        </header>

        <button
          type="button"
          onClick={() => navigate("/home/mode/mail/inbox")}
          className="workspace-action-row rounded-xl p-3 text-left"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/70">
            <HugeiconsIcon icon={Message01Icon} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">Inbox</span>
            <span className="block text-xs text-muted-foreground">See all connected mailboxes and approval queue in one place.</span>
          </span>
          <span className="text-muted-foreground" aria-hidden="true">{">"}</span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/home/mode/mail/connect-mail")}
          className="workspace-action-row rounded-xl border-sky-400/35 bg-[linear-gradient(140deg,hsl(var(--mode-mail)/0.16),hsl(var(--mode-mail)/0.05)_50%,hsl(var(--workspace-surface-2)))] p-3 text-left"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/70">
            <HugeiconsIcon icon={ServerStackIcon} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
              Connect Mail
              <HugeiconsIcon icon={Settings2} className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            </span>
            <span className="block text-xs text-muted-foreground">Connect Gmail/Outlook or configure a new @capzero.com mailbox.</span>
          </span>
          <span className="text-muted-foreground" aria-hidden="true">{">"}</span>
        </button>
      </div>
    </section>
  );
}
