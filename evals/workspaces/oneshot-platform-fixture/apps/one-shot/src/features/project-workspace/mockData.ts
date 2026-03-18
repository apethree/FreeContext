import { safeProjectName } from "@/features/app/defaults";
import type {
  AppSpec,
  CreateProjectDraft,
  ProjectVersion,
  ProjectWorkspaceSnapshot,
  StagedChange,
  WorkspaceEdge,
  WorkspaceEvent,
  WorkspaceNode,
} from "@/features/project-workspace/types";

function createNode(
  id: string,
  title: string,
  description: string,
  status: WorkspaceNode["status"],
  depends_on: string[],
  category: string,
  priority: number,
): WorkspaceNode {
  return {
    id,
    title,
    description,
    category,
    priority,
    depends_on,
    status,
    skills_required: ["project-initialization"],
    skills_recommended: ["frontend-design"],
    skill_bindings: [
      {
        skill_slug: "project-initialization",
        skill_name: "Project Initialization",
        binding_type: "required",
        version: "1.0.0",
        confidence: 0.95,
        rationale: "Every node in the starter flow assumes initialization artifacts exist.",
      },
      {
        skill_slug: "frontend-design",
        skill_name: "Frontend Design",
        binding_type: "recommended",
        version: "1.0.0",
        confidence: 0.77,
        rationale: "UI-focused workspace defaults to design quality guidance.",
      },
    ],
    acceptance_criteria: [
      "Implementation follows project spec",
      "Regression checks pass for this scope",
    ],
    notes: "",
    validation: {
      verdict: null,
      summary: null,
      artifacts: [],
    },
    model_plan: {
      suggestedModel: "gpt-5-mini",
      suggestedProvider: "openai",
      overrideModel: null,
      overrideProvider: null,
      isLocked: false,
      rationale: "Balanced cost and quality for iterative implementation.",
      confidence: 0.82,
    },
    task_files: [],
    estimateMinutes: 20,
  };
}

function createDefaultNodes(projectName: string): WorkspaceNode[] {
  return [
    createNode(
      "discover",
      "Discover product goals",
      `Capture user goals and scope for ${projectName}.`,
      "done",
      [],
      "planning",
      1,
    ),
    createNode(
      "scaffold",
      "Scaffold UI shell",
      "Set up route, layout, and baseline components.",
      "in_progress",
      ["discover"],
      "frontend",
      2,
    ),
    createNode(
      "wire",
      "Wire interactions",
      "Connect page state, actions, and local persistence.",
      "ready",
      ["scaffold"],
      "frontend",
      3,
    ),
    createNode(
      "validate",
      "Validate and polish",
      "Run lint/type checks and complete final UX polish.",
      "pending",
      ["wire"],
      "qa",
      4,
    ),
  ];
}

function createDefaultEdges(nodes: WorkspaceNode[]): WorkspaceEdge[] {
  return nodes
    .flatMap((node) => node.depends_on.map((source) => ({ source, target: node.id })))
    .map((entry) => ({
      id: `${entry.source}->${entry.target}`,
      source: entry.source,
      target: entry.target,
    }));
}

function createDefaultEvents(nodes: WorkspaceNode[]): WorkspaceEvent[] {
  return nodes.slice(0, 2).map((node, index) => ({
    id: `evt-${node.id}-${index + 1}`,
    timestamp: new Date(Date.now() - (index + 1) * 60000).toISOString(),
    type: node.status === "done" ? "node_completed" : "node_started",
    node_id: node.id,
    details:
      node.status === "done"
        ? `${node.title} completed.`
        : `${node.title} is currently in progress.`,
    payload: {},
  }));
}

function createDefaultVersions(): ProjectVersion[] {
  return [
    {
      id: "v1",
      timestamp: new Date(Date.now() - 20 * 60_000).toISOString(),
      title: "Initial plan",
      summary: "Generated starter graph and execution context.",
    },
    {
      id: "v2",
      timestamp: new Date(Date.now() - 8 * 60_000).toISOString(),
      title: "Scaffold update",
      summary: "Expanded implementation nodes for UI shell and flow wiring.",
    },
  ];
}

function createDefaultChanges(nodes: WorkspaceNode[]): StagedChange[] {
  return [
    {
      id: "chg-1",
      nodeId: nodes[1]?.id || "scaffold",
      title: "Topbar alignment polish",
      description: "Align title and actions with native controls baseline.",
      kind: "update",
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    {
      id: "chg-2",
      nodeId: nodes[2]?.id || "wire",
      title: "Workspace route state sync",
      description: "Persist run context for project workspace transitions.",
      kind: "create",
      createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    },
  ];
}

function createDefaultSpec(projectName: string): AppSpec {
  return {
    productName: projectName,
    summary:
      "A desktop-first AI development environment with guided build workflows and local execution controls.",
    sections: [
      {
        id: "goals",
        title: "Goals",
        content:
          "Provide a fast route from project intent to a runnable implementation with clear workflow visibility.",
      },
      {
        id: "constraints",
        title: "Constraints",
        content:
          "Maintain Electron-friendly UX, local-first persistence, and clear stubs for backend-managed actions.",
      },
      {
        id: "next",
        title: "Next steps",
        content:
          "Finalize graph edits, execution events, and backend sync after UI parity is complete.",
      },
    ],
  };
}

export function workspaceSnapshotKey(projectPath: string, runId: string) {
  return `${projectPath}::${runId}`;
}

export function createWorkspaceSnapshot(
  projectPath: string,
  runId: string,
  projectName?: string,
): ProjectWorkspaceSnapshot {
  const displayName = projectName || safeProjectName(projectPath);
  const nodes = createDefaultNodes(displayName);
  const edges = createDefaultEdges(nodes);
  return {
    projectPath,
    runId,
    phase: "build",
    nodes,
    edges,
    runState: {
      activeNodeId: nodes.find((node) => node.status === "in_progress")?.id || nodes[0]?.id || "",
      lastCompletedNodeId: nodes.find((node) => node.status === "done")?.id || "",
      haltReason: "none",
      haltNodeId: "",
      haltDetails: "",
      updatedAt: new Date().toISOString(),
    },
    events: createDefaultEvents(nodes),
    appSpec: createDefaultSpec(displayName),
    versions: createDefaultVersions(),
    stagedChanges: createDefaultChanges(nodes),
    chatMessages: [
      {
        id: "assistant-seed",
        role: "assistant",
        text: `Workspace initialized for ${displayName}. Continue from the active node or ask for a refinement.`,
        createdAt: new Date().toISOString(),
      },
    ],
    lastUpdatedAt: new Date().toISOString(),
  };
}

export const DEFAULT_CREATE_PROJECT_DRAFT: CreateProjectDraft = {
  selectedIntent: "web-app",
  projectName: "",
  projectDescription: "",
  selectedAgents: [],
  selectedTechnologies: [],
  selectedSkills: [],
  selectedProvider: "openai",
  selectedModel: "gpt-5-mini",
  createStep: "curate",
  technologiesAutoMode: true,
  skillsAutoMode: true,
  assistantMessage: "",
  progressMessage: "",
};
