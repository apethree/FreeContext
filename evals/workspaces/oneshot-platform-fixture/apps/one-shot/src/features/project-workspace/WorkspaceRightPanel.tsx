import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { statusBadgeClass, statusLabel } from "@/features/project-workspace/helpers";
import type { ProjectWorkspaceSnapshot, WorkspaceNode } from "@/features/project-workspace/types";

type WorkspaceRightPanelProps = {
  snapshot: ProjectWorkspaceSnapshot;
  selectedNode: WorkspaceNode | null;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onSaveNodeNote: () => void;
  onApproveStagedChange: (changeId: string) => void;
  onRejectStagedChange: (changeId: string) => void;
};

export function WorkspaceRightPanel({
  snapshot,
  selectedNode,
  noteDraft,
  onNoteDraftChange,
  onSaveNodeNote,
  onApproveStagedChange,
  onRejectStagedChange,
}: WorkspaceRightPanelProps) {
  const selectedNodeEvents = useMemo(
    () =>
      selectedNode
        ? snapshot.events.filter((event) => event.node_id === selectedNode.id)
        : [],
    [selectedNode, snapshot.events],
  );
  const selectedNodeBindings = selectedNode && Array.isArray(selectedNode.skill_bindings)
    ? selectedNode.skill_bindings
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/70 bg-card/85">
      <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/65 px-2 py-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="spec">App Spec</TabsTrigger>
            <TabsTrigger value="staged">Staged</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="details" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full px-3 py-3">
            {selectedNode ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{selectedNode.title}</p>
                    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium", statusBadgeClass(selectedNode.status))}>
                      {statusLabel(selectedNode.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedNode.description}</p>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
                    <p className="text-muted-foreground">Category</p>
                    <p className="font-medium">{selectedNode.category}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
                    <p className="text-muted-foreground">Priority</p>
                    <p className="font-medium">{selectedNode.priority}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                  {selectedNodeBindings.length > 0 ? (
                    <ul className="space-y-1">
                      {selectedNodeBindings.map((binding) => (
                        <li key={`${binding.binding_type}-${binding.skill_slug}`} className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{binding.skill_name || binding.skill_slug}</p>
                            <p className="text-[11px] uppercase text-muted-foreground">{binding.binding_type}</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Version: {binding.version || "latest"} · Confidence: {binding.confidence != null ? binding.confidence.toFixed(2) : "n/a"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="space-y-1">
                      {selectedNode.skills_required.map((skill) => (
                        <li key={`required-${skill}`} className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{skill}</p>
                            <p className="text-[11px] uppercase text-muted-foreground">required</p>
                          </div>
                        </li>
                      ))}
                      {selectedNode.skills_recommended.map((skill) => (
                        <li key={`recommended-${skill}`} className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{skill}</p>
                            <p className="text-[11px] uppercase text-muted-foreground">recommended</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acceptance criteria</p>
                  <ul className="space-y-1">
                    {selectedNode.acceptance_criteria.map((criteria) => (
                      <li key={criteria} className="rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs">
                        {criteria}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node notes</p>
                  <Textarea
                    rows={4}
                    value={noteDraft}
                    onChange={(event) => onNoteDraftChange(event.target.value)}
                    placeholder="Capture implementation notes for this node..."
                  />
                  <Button type="button" size="sm" onClick={onSaveNodeNote}>
                    Save note
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node events</p>
                  {selectedNodeEvents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No events for this node.</p>
                  ) : (
                    selectedNodeEvents.map((event) => (
                      <div key={event.id} className="rounded-md border border-border/70 bg-background px-2 py-1.5">
                        <p className="text-xs font-medium">{event.type}</p>
                        <p className="text-xs text-muted-foreground">{event.details}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Select a node to view details.</p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="spec" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full px-3 py-3">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">{snapshot.appSpec.productName}</p>
                <p className="text-xs text-muted-foreground">{snapshot.appSpec.summary}</p>
              </div>
              {snapshot.appSpec.sections.map((section) => (
                <div key={section.id} className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
                  <p className="mt-1 text-xs">{section.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="staged" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full px-3 py-3">
            <div className="space-y-2">
              {snapshot.stagedChanges.length === 0 ? (
                <p className="text-xs text-muted-foreground">No staged changes.</p>
              ) : (
                snapshot.stagedChanges.map((change) => (
                  <div key={change.id} className="rounded-md border border-border/70 bg-background px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{change.title}</p>
                        <p className="text-xs text-muted-foreground">{change.description}</p>
                      </div>
                      <Badge variant="muted">{change.kind}</Badge>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="xs" onClick={() => onApproveStagedChange(change.id)}>
                        Approve
                      </Button>
                      <Button type="button" size="xs" variant="outline" onClick={() => onRejectStagedChange(change.id)}>
                        Reject
                      </Button>
                    </div>
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
