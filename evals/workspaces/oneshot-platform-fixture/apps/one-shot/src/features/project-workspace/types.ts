export type NodeStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "blocked_user_input"
  | "blocked_review"
  | "done"
  | "failed";

export type WorkspacePhase = "discover" | "build" | "validate" | "ship";

export interface ValidationArtifact {
  id: string;
  label: string;
  summary: string;
  url?: string;
}

export interface NodeValidationState {
  verdict: "pass" | "fail" | "needs_review" | null;
  summary: string | null;
  artifacts: ValidationArtifact[];
}

export interface NodeModelPlan {
  suggestedModel: string | null;
  suggestedProvider: string | null;
  overrideModel: string | null;
  overrideProvider: string | null;
  isLocked: boolean;
  rationale: string | null;
  confidence: number | null;
}

export interface TaskFile {
  name: string;
  path: string;
  type: "yaml" | "md" | "json" | "ts" | "py" | "other";
  sizeBytes?: number;
}

export interface WorkspaceNodeSkillBinding {
  skill_slug: string;
  skill_name?: string | null;
  binding_type: "required" | "recommended" | "optional";
  version?: string | null;
  confidence?: number | null;
  rationale?: string | null;
}

export interface WorkspaceNode {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  depends_on: string[];
  status: NodeStatus;
  skills_required: string[];
  skills_recommended: string[];
  skill_bindings: WorkspaceNodeSkillBinding[];
  acceptance_criteria: string[];
  notes: string;
  validation: NodeValidationState;
  model_plan: NodeModelPlan;
  task_files: TaskFile[];
  estimateMinutes: number;
}

export interface WorkspaceEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkspaceEvent {
  id: string;
  timestamp: string;
  type: string;
  node_id: string;
  details: string;
  payload: Record<string, unknown>;
}

export interface ProjectVersion {
  id: string;
  timestamp: string;
  title: string;
  summary: string;
}

export interface StagedChange {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  kind: "create" | "update" | "delete";
  createdAt: string;
}

export interface AppSpecSection {
  id: string;
  title: string;
  content: string;
}

export interface AppSpec {
  productName: string;
  summary: string;
  sections: AppSpecSection[];
}

export interface WorkspaceRunState {
  activeNodeId: string;
  lastCompletedNodeId: string;
  haltReason: "none" | "needs_user_input" | "needs_review" | "error";
  haltNodeId: string;
  haltDetails: string;
  updatedAt: string;
}

export interface WorkspaceChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ProjectWorkspaceSnapshot {
  projectPath: string;
  runId: string;
  phase: WorkspacePhase;
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
  runState: WorkspaceRunState;
  events: WorkspaceEvent[];
  appSpec: AppSpec;
  versions: ProjectVersion[];
  stagedChanges: StagedChange[];
  chatMessages: WorkspaceChatMessage[];
  lastUpdatedAt: string;
}

export interface CreateProjectDraft {
  selectedIntent: string;
  projectName: string;
  projectDescription: string;
  selectedAgents: string[];
  selectedTechnologies: string[];
  selectedSkills: string[];
  selectedProvider: string;
  selectedModel: string;
  createStep: "curate";
  technologiesAutoMode: boolean;
  skillsAutoMode: boolean;
  assistantMessage: string;
  progressMessage: string;
}
