import { useEffect, useMemo } from "react";
import { graphlib, layout as dagreLayout } from "dagre";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type NodeProps,
  ReactFlow,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { statusBadgeClass, statusLabel } from "@/features/project-workspace/helpers";
import type { WorkspaceEdge, WorkspaceNode } from "@/features/project-workspace/types";

type WorkspaceDagCanvasProps = {
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
};

const NODE_WIDTH = 240;
const NODE_HEIGHT = 88;
type DagNodeData = {
  node: WorkspaceNode;
  __selected: boolean;
};
type DagNode = Node<DagNodeData>;

function getLayoutedElements(
  nodes: WorkspaceNode[],
  edges: WorkspaceEdge[],
): { nodes: DagNode[]; edges: Edge[] } {
  const graph = new graphlib.Graph();
  graph.setGraph({
    rankdir: "TB",
    ranksep: 70,
    nodesep: 36,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagreLayout(graph);

  const flowNodes: DagNode[] = nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      id: node.id,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      data: {
        node,
        __selected: false,
      },
      type: "default",
      style: {
        width: NODE_WIDTH,
        borderRadius: 12,
        borderWidth: 1,
      },
    };
  });

  const flowEdges: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
    },
    style: {
      strokeWidth: 1.5,
    },
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

function DagNodeCard({ node, selected }: { node: WorkspaceNode; selected: boolean }) {
  const nodeBindings = Array.isArray(node.skill_bindings) ? node.skill_bindings : [];
  const chips = nodeBindings.length > 0
    ? nodeBindings.map((binding) => ({
        label: binding.skill_name || binding.skill_slug,
        type: binding.binding_type,
      }))
    : [
        ...node.skills_required.map((skill) => ({ label: skill, type: "required" as const })),
        ...node.skills_recommended.map((skill) => ({ label: skill, type: "recommended" as const })),
      ];

  return (
    <div
      className={cn(
        "h-full rounded-md border bg-card/95 px-3 py-2 text-left shadow-sm transition-colors",
        selected
          ? "border-primary/60 ring-2 ring-primary/20"
          : "border-border/70 hover:border-primary/35",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {node.category}
        </p>
        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-medium", statusBadgeClass(node.status))}>
          {statusLabel(node.status)}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-sm font-semibold">{node.title}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.slice(0, 3).map((chip) => (
            <span
              key={`${node.id}-${chip.type}-${chip.label}`}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                chip.type === "required"
                  ? "bg-emerald-500/15 text-emerald-700"
                  : chip.type === "recommended"
                    ? "bg-sky-500/15 text-sky-700"
                    : "bg-amber-500/15 text-amber-700",
              )}
            >
              {chip.label}
            </span>
          ))}
          {chips.length > 3 ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{chips.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceDagCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: WorkspaceDagCanvasProps) {
  const layouted = useMemo(() => getLayoutedElements(nodes, edges), [nodes, edges]);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(layouted.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(layouted.edges);

  useEffect(() => {
    setFlowNodes(layouted.nodes);
    setFlowEdges(layouted.edges);
  }, [layouted, setFlowEdges, setFlowNodes]);

  const renderedNodes = useMemo(
    () =>
      flowNodes.map((node) => ({
        ...node,
        data: {
          node: node.data.node,
          __selected: node.id === selectedNodeId,
        },
      })),
    [flowNodes, selectedNodeId],
  );

  const nodeTypes = useMemo(
    () => ({
      default: ({ data, id }: NodeProps<DagNode>) => (
        <button
          type="button"
          className="h-full w-full cursor-pointer text-left"
          onClick={() => onSelectNode(id)}
        >
          <DagNodeCard node={data.node} selected={Boolean(data.__selected)} />
        </button>
      ),
    }),
    [onSelectNode],
  );

  return (
    <div className="h-full rounded-md border border-border/70 bg-background/70">
      <ReactFlow
        nodes={renderedNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        nodesConnectable={false}
        nodesDraggable={false}
        panOnDrag
      >
        <Background gap={20} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
