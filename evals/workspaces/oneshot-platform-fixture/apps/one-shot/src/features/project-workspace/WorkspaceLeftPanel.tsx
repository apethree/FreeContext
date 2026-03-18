import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sortNodes, statusBadgeClass, statusLabel } from "@/features/project-workspace/helpers";
import type { WorkspaceEvent, WorkspaceNode } from "@/features/project-workspace/types";

type WorkspaceLeftPanelProps = {
  nodes: WorkspaceNode[];
  events: WorkspaceEvent[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
};

export function WorkspaceLeftPanel({
  nodes,
  events,
  selectedNodeId,
  onSelectNode,
}: WorkspaceLeftPanelProps) {
  const sorted = sortNodes(nodes);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/70 bg-card/85">
      <Tabs defaultValue="nodes" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/65 px-2 py-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="nodes">Nodes</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="nodes" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full px-2 py-2">
            <div className="space-y-2 pb-2">
              {sorted.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className={cn(
                    "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                    selectedNodeId === node.id
                      ? "border-primary/45 bg-primary/10"
                      : "border-border/70 bg-background hover:bg-accent/45",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{node.title}</span>
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(node.status))}>
                      {statusLabel(node.status)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="events" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full px-2 py-2">
            <div className="space-y-2 pb-2">
              {events.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No events yet.</p>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{event.type}</p>
                      <Badge variant="muted">{new Date(event.timestamp).toLocaleTimeString()}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{event.details}</p>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
