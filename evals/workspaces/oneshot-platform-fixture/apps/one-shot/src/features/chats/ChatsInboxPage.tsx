import { useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Filter, Layers3, MessageSquareText, Search } from "lucide-react";
import { FaApple, FaDiscord, FaSlack, FaTelegramPlane, FaWhatsapp } from "react-icons/fa";

type InboxStatus = "ok" | "needs-approval" | "unread";
type InboxChannel = "whatsapp" | "imessage" | "telegram" | "slack" | "discord";

type InboxContact = {
  id: string;
  name: string;
  initials: string;
  info: string;
  channels: InboxChannel[];
  status: InboxStatus;
  preview: string;
  summary: string;
  updatedAt: string;
  history: Array<{ at: string; text: string; channel: string }>;
};

const CONTACTS: InboxContact[] = [
  {
    id: "alex-chen",
    name: "Alex Chen",
    initials: "AC",
    info: "Personal scheduling",
    channels: ["whatsapp", "imessage"],
    status: "needs-approval",
    preview: "Agent drafted ETA confirmation for tonight.",
    summary: "Agent drafted ETA confirmation, waiting for approval.",
    updatedAt: "2m ago",
    history: [
      { at: "2m ago", text: "Are we still on for tonight at 7?", channel: "WhatsApp" },
      { at: "1m ago", text: "Drafted: yes, will share ETA at 6:30.", channel: "WhatsApp" },
    ],
  },
  {
    id: "ops-team",
    name: "Ops Team",
    initials: "OT",
    info: "Incident broadcast",
    channels: ["imessage", "slack"],
    status: "needs-approval",
    preview: "Outbound outage wording requires review.",
    summary: "Outbound outage wording requires manual review.",
    updatedAt: "5m ago",
    history: [
      { at: "5m ago", text: "Need confirmation before broadcast.", channel: "iMessage" },
      { at: "4m ago", text: "Drafted impact summary + ETA.", channel: "iMessage" },
    ],
  },
  {
    id: "maya-singh",
    name: "Maya Singh",
    initials: "MS",
    info: "Client coordination",
    channels: ["telegram", "whatsapp"],
    status: "unread",
    preview: "Asked to move review call to tomorrow morning.",
    summary: "Asked to move review call to tomorrow morning.",
    updatedAt: "17m ago",
    history: [
      { at: "17m ago", text: "Can we move the review call?", channel: "Telegram" },
      { at: "15m ago", text: "Suggested two alternate slots.", channel: "Telegram" },
    ],
  },
  {
    id: "support-queue",
    name: "Support Queue",
    initials: "SQ",
    info: "Tier-1 handoffs",
    channels: ["slack", "discord"],
    status: "ok",
    preview: "Auto-responses healthy, no manual intervention needed.",
    summary: "Auto-responses healthy, no manual intervention needed.",
    updatedAt: "8m ago",
    history: [{ at: "8m ago", text: "Auto-reply sent for billing query.", channel: "Slack" }],
  },
  {
    id: "community-mods",
    name: "Community Mods",
    initials: "CM",
    info: "Discord moderation",
    channels: ["discord", "telegram"],
    status: "ok",
    preview: "Agent handled FAQ wave and pinned latest update.",
    summary: "Agent handled FAQ wave and pinned latest update.",
    updatedAt: "10m ago",
    history: [{ at: "10m ago", text: "FAQ response batch complete.", channel: "Discord" }],
  },
];

function channelLabel(channel: InboxChannel) {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "imessage") return "iMessage";
  if (channel === "telegram") return "Telegram";
  if (channel === "slack") return "Slack";
  return "Discord";
}

function statusLabel(status: InboxStatus) {
  if (status === "needs-approval") return "Needs approval";
  if (status === "unread") return "Unread";
  return "Healthy";
}

function channelIcon(channel: InboxChannel) {
  if (channel === "whatsapp") return FaWhatsapp;
  if (channel === "imessage") return FaApple;
  if (channel === "telegram") return FaTelegramPlane;
  if (channel === "slack") return FaSlack;
  return FaDiscord;
}

export function ChatsInboxPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState<"all" | InboxChannel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | InboxStatus>("all");
  const [contactChannelView, setContactChannelView] = useState<"all" | InboxChannel>("all");
  const [selectedId, setSelectedId] = useState(CONTACTS[0]?.id ?? "");

  const filteredContacts = useMemo(() => {
    return CONTACTS.filter((contact) => {
      if (channelFilter !== "all" && !contact.channels.includes(channelFilter)) return false;
      if (statusFilter !== "all" && contact.status !== statusFilter) return false;
      return true;
    });
  }, [channelFilter, statusFilter]);

  const selected =
    filteredContacts.find((contact) => contact.id === selectedId) ?? filteredContacts[0] ?? CONTACTS[0];

  const selectedHistory = useMemo(() => {
    if (!selected) return [];
    if (contactChannelView === "all") return selected.history;
    return selected.history.filter((entry) => entry.channel.toLowerCase() === channelLabel(contactChannelView).toLowerCase());
  }, [contactChannelView, selected]);

  const clearFilters = () => {
    setChannelFilter("all");
    setStatusFilter("all");
  };

  return (
    <section className="workspace-shell">
      <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0">
        <ResizablePanel defaultSize="42%" minSize="30%" className="min-w-0 overflow-hidden">
          <aside className="workspace-pane min-w-0">
            <div className="workspace-pane-header">
              <div className="workspace-section-title">
                <span>Contacts</span>
                <span className="workspace-tag">{filteredContacts.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="workspace-icon-btn"
                  aria-label="Search contacts"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="h-4 w-4" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="workspace-icon-btn" aria-label="Filter contacts">
                      <Filter className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">
                      Channel
                    </div>
                    {(["all", "whatsapp", "imessage", "telegram", "slack", "discord"] as const).map((channel) => (
                      <DropdownMenuItem key={channel} onSelect={() => setChannelFilter(channel)}>
                        <span className="text-xs">{channel === "all" ? "All channels" : channelLabel(channel)}</span>
                        {channelFilter === channel ? (
                          <Check className="ml-auto h-3.5 w-3.5 text-foreground/80" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    <div className="my-1 h-px bg-border/70" />
                    <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">
                      Status
                    </div>
                    {(["all", "needs-approval", "unread", "ok"] as const).map((status) => (
                      <DropdownMenuItem key={status} onSelect={() => setStatusFilter(status)}>
                        <span className="text-xs">{status === "all" ? "All status" : statusLabel(status)}</span>
                        {statusFilter === status ? (
                          <Check className="ml-auto h-3.5 w-3.5 text-foreground/80" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    <div className="my-1 h-px bg-border/70" />
                    <DropdownMenuItem onSelect={clearFilters}>
                      <span className="text-xs">Clear filters</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="workspace-scroll min-h-0 flex-1 space-y-1.5 pr-0.5">
              {filteredContacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(contact.id);
                    setContactChannelView("all");
                  }}
                  className={`workspace-action-row workspace-contact-row w-full items-start text-left ${
                    selected?.id === contact.id ? "workspace-contact-row-active" : ""
                  }`}
                >
                  <span className="workspace-contact-initials">{contact.initials}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[15px] font-semibold text-foreground">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">{contact.updatedAt}</p>
                    </div>
                    <p className="truncate text-[13px] text-muted-foreground">{contact.preview}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {contact.channels.map((channel) => {
                        const Icon = channelIcon(channel);
                        return (
                          <Tooltip key={`${contact.id}-${channel}`}>
                            <TooltipTrigger asChild>
                              <span className="workspace-channel-dot" aria-label={channelLabel(channel)}>
                                <Icon className="h-3 w-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {channelLabel(channel)}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        </ResizablePanel>

        <ResizableHandle withHandle className="z-20 bg-border/80" />

        <ResizablePanel defaultSize="58%" minSize="42%" className="min-w-0 overflow-hidden">
          <main className="workspace-canvas min-w-0">
            <header className="workspace-canvas-topbar">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-foreground">{selected?.name}</p>
                <p className="truncate text-sm text-muted-foreground">{selected?.info}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setContactChannelView("all")}
                  className={`workspace-channel-filter ${
                    contactChannelView === "all" ? "workspace-channel-filter-active" : ""
                  }`}
                  aria-label="View all channels"
                >
                  <Layers3 className="h-3.5 w-3.5" />
                </button>
                {selected?.channels.map((channel) => {
                  const Icon = channelIcon(channel);
                  const isActive = contactChannelView === channel;
                  return (
                    <Tooltip key={`selected-${selected.id}-${channel}`}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setContactChannelView(channel)}
                          className={`workspace-channel-filter ${isActive ? "workspace-channel-filter-active" : ""}`}
                          aria-label={channelLabel(channel)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {channelLabel(channel)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </header>

            <div className="workspace-canvas-body">
              <section className="workspace-summary-card">
                <div className="workspace-section-title">
                  <span>Summary</span>
                  <span className="workspace-tag">{selected?.updatedAt}</span>
                </div>
                <p className="mt-2 text-sm text-foreground/90">{selected?.summary}</p>
              </section>

              <div className="workspace-divider mt-3">
                <span>{contactChannelView === "all" ? "Contact timeline" : channelLabel(contactChannelView)}</span>
              </div>

              <section className="space-y-1.5">
                {selectedHistory.map((entry) => (
                  <article key={`${entry.at}-${entry.text}`} className="workspace-message-in">
                    <p className="workspace-message-title">{entry.channel}</p>
                    <p className="workspace-message-body">{entry.text}</p>
                    <p className="workspace-message-meta">{entry.at}</p>
                  </article>
                ))}
              </section>

              <section className="workspace-aware-line mt-3">
                <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
                One contact memory merges every channel touchpoint.
              </section>
            </div>
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>

      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search contacts"
        description="Search by name, context, or summary."
        className="sm:max-w-[520px]"
      >
        <CommandInput placeholder="Search contacts..." />
        <CommandList>
          <CommandEmpty>No contacts found.</CommandEmpty>
          <CommandGroup heading="Contacts">
            {CONTACTS.map((contact) => (
              <CommandItem
                key={contact.id}
                value={`${contact.name} ${contact.info} ${contact.summary}`}
                onSelect={() => {
                  setSelectedId(contact.id);
                  setContactChannelView("all");
                  setSearchOpen(false);
                }}
              >
                <span className="workspace-contact-initials">{contact.initials}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{contact.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{contact.info}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </section>
  );
}
