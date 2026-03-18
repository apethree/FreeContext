import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CHANNEL_CATALOG, getChannelDefinition, type ChannelDefinition } from "./channelCatalog";

type MockInstance = {
  id: string;
  type: string;
  status: "disconnected" | "connecting" | "connected" | "error";
};

const MOCK_INSTANCES: MockInstance[] = CHANNEL_CATALOG.map((item) => ({
  id: `${item.id}-1`,
  type: item.id,
  status: "disconnected",
}));

export function ManageChannelsMock() {
  const [instances] = useState<MockInstance[]>(MOCK_INSTANCES);
  const [selectedId, setSelectedId] = useState<string>(MOCK_INSTANCES[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return instances.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (!q) return true;
      return item.id.toLowerCase().includes(q) || item.type.toLowerCase().includes(q);
    });
  }, [instances, query, typeFilter]);

  const selected = instances.find((item) => item.id === selectedId) ?? null;
  const definition: ChannelDefinition | null = selected ? getChannelDefinition(selected.type) : null;

  return (
    <section className="workspace-shell">
      <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0">
        <ResizablePanel defaultSize="42%" minSize="30%" className="min-w-0 overflow-hidden">
          <aside className="workspace-pane min-w-0">
            <div className="workspace-pane-header">
              <div className="workspace-section-title">
                <span>Channels (Mock)</span>
                <span className="workspace-tag">{filtered.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="workspace-icon-btn" aria-label="Refresh channels">
                  <HugeiconsIcon icon={RefreshCw} className="h-4 w-4" />
                </button>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                >
                  <option value="all">All types</option>
                  {CHANNEL_CATALOG.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
                <Button type="button" size="xs" className="h-7 text-[10px]">
                  <HugeiconsIcon icon={Plus} className="mr-1 h-3.5 w-3.5" />
                  Add Channel
                </Button>
              </div>
            </div>

            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by id or type"
              className="mb-2 h-8"
            />

            <div className="workspace-scroll min-h-0 flex-1 space-y-1.5 pr-0.5">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`workspace-action-row w-full items-center text-left ${selectedId === item.id ? "workspace-contact-row-active" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground">{item.id}</p>
                    <p className="text-[10px] text-muted-foreground">{item.type}</p>
                  </div>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    Disconnected
                  </span>
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
                <p className="truncate text-[15px] font-semibold text-foreground">{selected?.id ?? "Select a channel"}</p>
                <p className="truncate text-[12px] text-muted-foreground">{definition?.label ?? "No channel selected"}</p>
              </div>
            </header>

            <div className="workspace-canvas-body">
              {!definition ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Select a channel instance on the left.
                </div>
              ) : (
                <div className="space-y-3">
                  <section className="workspace-summary-card">
                    <div className="workspace-section-title">
                      <span>Configuration</span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {definition.configFields.map((field) => (
                        <div key={field.key} className="workspace-input-row">
                          <span className="workspace-tag">{field.label}</span>
                          <Input
                            placeholder={field.placeholder}
                            className="h-7 border-none bg-transparent px-0 text-[11px] shadow-none focus-visible:ring-0"
                          />
                        </div>
                      ))}
                      <div className="workspace-input-row">
                        <span className="workspace-tag">System Prompt</span>
                        <textarea
                          rows={3}
                          placeholder="Optional system prompt"
                          className="w-full resize-none border-none bg-transparent px-0 text-[11px] shadow-none outline-none"
                        />
                      </div>
                    </div>
                  </section>

                  <section className="workspace-summary-card">
                    <div className="workspace-section-title">
                      <span>Status</span>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">Disconnected</p>
                    <Button type="button" size="xs" className="mt-2 h-6 text-[10px]">Connect</Button>
                  </section>
                </div>
              )}
            </div>
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}
