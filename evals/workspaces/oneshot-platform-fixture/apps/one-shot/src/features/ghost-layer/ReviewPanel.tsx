import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useReviewSession } from './useReviewSession';
import type {
  AnnotationSessionExportV2,
  AnnotationSessionMode,
  AnnotationStep,
  SurfaceResource,
} from '@oneshot/annotation-core/types';
import type { ReviewIssue, ReviewSeverity } from './review-state';
import {
  Background,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const SEVERITY_BADGE: Record<ReviewSeverity, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-300' },
  major: { bg: 'bg-orange-500/20', text: 'text-orange-300' },
  minor: { bg: 'bg-yellow-500/20', text: 'text-yellow-300' },
  suggestion: { bg: 'bg-blue-500/20', text: 'text-blue-300' },
};

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-white/10', text: 'text-white/60', label: 'Open' },
  fixing: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', label: 'Fixing' },
  fixed: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Fixed' },
  verified: { bg: 'bg-green-500/30', text: 'text-green-200', label: 'Verified' },
  wont_fix: { bg: 'bg-white/10', text: 'text-white/40', label: "Won't Fix" },
};

function getResourceLabel(resource: SurfaceResource): string {
  if (resource.title?.trim()) return resource.title.trim();
  try {
    const parsed = new URL(resource.sourceUrl);
    const base = parsed.hostname || resource.surface;
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${base}${path}`;
  } catch {
    return resource.sourceUrl;
  }
}

function buildStepPreviewLookup(payload: AnnotationSessionExportV2): Map<string, string> {
  const assets = new Map(payload.assets.map((asset) => [asset.id, asset]));
  const byStep = new Map<string, string>();
  for (const annotation of payload.annotations) {
    if (annotation.type !== 'snapshot') continue;
    if (!annotation.stepId || !annotation.assetId) continue;
    if (byStep.has(annotation.stepId)) continue;
    const asset = assets.get(annotation.assetId);
    if (asset?.uri) {
      byStep.set(annotation.stepId, asset.uri);
    }
  }
  return byStep;
}

export function ReviewPanel({
  exportPayload,
  sessionMode,
  activeStepId,
  onSelectStep,
  onRenameStep,
  onRemoveStep,
  onClose,
}: {
  exportPayload: AnnotationSessionExportV2;
  sessionMode: AnnotationSessionMode;
  activeStepId: string | null;
  onSelectStep: (stepId: string) => void;
  onRenameStep: (stepId: string, title: string) => void;
  onRemoveStep: (stepId: string) => void;
  onClose: () => void;
}) {
  const [followUpText, setFollowUpText] = useState('');

  const {
    session,
    error,
    startReview,
    sendFollowUp,
    requestVerify,
    approveAndComplete,
    cancelReview,
  } = useReviewSession({
    provider: 'anthropic',
    runtime: 'auto',
    model: 'claude-sonnet-4-6',
  });

  const onStartReview = useCallback(() => {
    void startReview(exportPayload);
  }, [startReview, exportPayload]);

  const onSendFollowUp = useCallback(() => {
    if (!followUpText.trim()) return;
    void sendFollowUp(followUpText);
    setFollowUpText('');
  }, [followUpText, sendFollowUp]);

  const resourcesById = useMemo(
    () => new Map(exportPayload.resources.map((resource) => [resource.id, resource])),
    [exportPayload.resources],
  );

  const stepsByResource = useMemo(() => {
    const grouped = new Map<string, AnnotationStep[]>();
    for (const step of exportPayload.steps) {
      const existing = grouped.get(step.resourceId) ?? [];
      existing.push(step);
      grouped.set(step.resourceId, existing);
    }
    for (const [resourceId, steps] of grouped) {
      grouped.set(resourceId, [...steps].sort((a, b) => a.index - b.index));
    }
    return grouped;
  }, [exportPayload.steps]);

  const stepPreviewMap = useMemo(() => buildStepPreviewLookup(exportPayload), [exportPayload]);

  const statusLabel = useMemo(() => {
    switch (session.status) {
      case 'idle': return 'Ready to review';
      case 'reviewing': return 'Reviewing...';
      case 'sending': return 'Sending to agent...';
      case 'waiting': return 'Agent is working...';
      case 'fixing': return 'Agent is fixing issues...';
      case 'verifying': return `Verifying fixes (iteration ${session.iteration})...`;
      case 'complete': return 'Review complete';
      default: return session.status;
    }
  }, [session.status, session.iteration]);

  const isWorking = session.status === 'sending' || session.status === 'waiting' || session.status === 'fixing' || session.status === 'verifying';

  const flowNodes = useMemo<Node[]>(() => {
    return exportPayload.steps
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((step, idx) => {
        const resource = resourcesById.get(step.resourceId);
        const active = step.id === activeStepId;
        return {
          id: step.id,
          position: { x: 30, y: idx * 104 },
          data: {
            label: `${step.index + 1}. ${step.title || getResourceLabel(resource ?? {
              id: step.resourceId,
              key: '',
              surface: 'unknown',
              adapter: 'none',
              sourceUrl: step.resourceId,
              resolvedUrl: step.resourceId,
              editable: false,
              access: 'read-only',
              createdAt: '',
              lastSeenAt: '',
              revision: 0,
            })}`,
          },
          style: {
            width: 270,
            borderRadius: 10,
            padding: 10,
            border: active ? '1px solid rgba(96,165,250,0.85)' : '1px solid rgba(255,255,255,0.15)',
            background: active ? 'rgba(30,58,138,0.38)' : 'rgba(15,23,42,0.72)',
            color: 'rgba(255,255,255,0.92)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          },
          draggable: false,
          selectable: false,
        };
      });
  }, [exportPayload.steps, resourcesById, activeStepId]);

  const flowEdges = useMemo<Edge[]>(() => {
    const ordered = exportPayload.steps.slice().sort((a, b) => a.index - b.index);
    const edges: Edge[] = [];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      edges.push({
        id: `timeline_${ordered[i].id}_${ordered[i + 1].id}`,
        source: ordered[i].id,
        target: ordered[i + 1].id,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: 'rgba(96,165,250,0.55)', strokeWidth: 1.6 },
      });
    }
    return edges;
  }, [exportPayload.steps]);

  const nodeCountLabel = `You are submitting ${exportPayload.steps.length} step${exportPayload.steps.length === 1 ? '' : 's'} across ${exportPayload.resources.length} resource${exportPayload.resources.length === 1 ? '' : 's'}.`;

  return (
    <div className="absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-[420px] flex-col gap-2 rounded-xl border border-white/10 bg-black/72 p-3 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Ghost Review</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="rounded-md border border-blue-400/20 bg-blue-500/10 px-2 py-1.5 text-[11px] text-blue-100/90">
        <span className="font-semibold">{sessionMode === 'multi-resource' ? 'Multi-resource' : 'Single-resource'} mode</span>
        <p className="mt-1 text-[10px] text-blue-100/70">{nodeCountLabel}</p>
      </div>

      <div className="rounded-md border border-white/10 bg-white/5 p-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-white/50">Timeline</p>
        <div className="h-[220px] rounded-md border border-white/10 bg-[#040b14]">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            nodesConnectable={false}
            nodesDraggable={false}
            panOnDrag
            zoomOnScroll
            onNodeClick={(_, node) => onSelectStep(node.id)}
          >
            <Background gap={24} size={1} color="rgba(148,163,184,0.14)" />
          </ReactFlow>
        </div>
      </div>

      <details open className="rounded-md border border-white/10 bg-white/5 p-2">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-white/55">Submission Scope</summary>
        <div className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
          {exportPayload.session.resourceOrder.map((resourceId) => {
            const resource = resourcesById.get(resourceId);
            if (!resource) return null;
            const steps = stepsByResource.get(resourceId) ?? [];
            return (
              <div key={resourceId} className="rounded-md border border-white/10 bg-black/20 p-2">
                <p className="truncate text-xs font-medium text-white/85" title={resource.sourceUrl}>{getResourceLabel(resource)}</p>
                <div className="mt-1 space-y-1">
                  {steps.map((step) => {
                    const active = step.id === activeStepId;
                    const preview = step.previewAssetId ? stepPreviewMap.get(step.id) : stepPreviewMap.get(step.id);
                    return (
                      <div
                        key={step.id}
                        className={active ? 'rounded-md border border-blue-400/40 bg-blue-500/10 p-1.5' : 'rounded-md border border-white/10 bg-black/25 p-1.5'}
                      >
                        <div className="flex items-center gap-1.5">
                          {preview ? (
                            <img src={preview} alt="step preview" className="h-8 w-12 rounded-sm border border-white/10 object-cover" />
                          ) : (
                            <div className="flex h-8 w-12 items-center justify-center rounded-sm border border-white/10 bg-white/5 text-[9px] text-white/35">No preview</div>
                          )}
                          <button
                            type="button"
                            className="flex-1 truncate text-left text-[11px] text-white/80 hover:text-white"
                            onClick={() => onSelectStep(step.id)}
                            title={step.title || `Step ${step.index + 1}`}
                          >
                            {step.index + 1}. {step.title || 'Untitled step'}
                          </button>
                          <button
                            type="button"
                            className="rounded border border-white/15 px-1 py-0.5 text-[9px] text-white/60 hover:bg-white/10 hover:text-white"
                            onClick={() => {
                              const next = window.prompt('Rename step', step.title || `Step ${step.index + 1}`);
                              if (!next) return;
                              const normalized = next.trim();
                              if (!normalized) return;
                              onRenameStep(step.id, normalized);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="rounded border border-red-400/30 px-1 py-0.5 text-[9px] text-red-200/75 hover:bg-red-500/20"
                            onClick={() => onRemoveStep(step.id)}
                            disabled={exportPayload.steps.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* Status */}
      <div className="flex items-center gap-2">
        {isWorking && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        )}
        {session.status === 'complete' && (
          <span className="h-2 w-2 rounded-full bg-green-400" />
        )}
        <span className="text-xs text-white/60">{statusLabel}</span>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Not started */}
      {!session.active && session.status === 'idle' && (
        <div className="space-y-2">
          <p className="text-xs text-white/50">
            {exportPayload.annotations.length > 0
              ? `Send ${exportPayload.annotations.length} annotation${exportPayload.annotations.length !== 1 ? 's' : ''} to an agent for review and fixing.`
              : 'Start an automated review and generate improvement suggestions.'}
          </p>
          <Button
            size="sm"
            className="w-full"
            onClick={onStartReview}
          >
            {exportPayload.annotations.length > 0 ? 'Send Session to Agent' : 'Start Auto-Review'}
          </Button>
        </div>
      )}

      {/* Active session */}
      {session.active && (
        <>
          {/* Iteration counter */}
          <div className="flex items-center justify-between text-[10px] text-white/40">
            <span>Iteration {session.iteration}/{session.maxIterations}</span>
            <span>{session.issues.length} issues tracked</span>
          </div>

          {/* Issue list */}
          {session.issues.length > 0 && (
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {session.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </div>
          )}

          {/* Agent messages */}
          {session.agentMessages.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-md bg-white/5 p-2">
              {session.agentMessages.slice(-3).map((msg, i) => (
                <p key={i} className="text-[11px] leading-relaxed text-white/70">
                  {msg.length > 200 ? `${msg.slice(0, 200)}...` : msg}
                </p>
              ))}
            </div>
          )}

          {/* Follow-up input */}
          {!isWorking && session.status !== 'complete' && (
            <div className="flex gap-1">
              <input
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSendFollowUp();
                  }
                }}
                placeholder="Tell the agent what to fix..."
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/30"
              />
              <Button size="sm" variant="outline" className="text-xs" onClick={onSendFollowUp} disabled={!followUpText.trim()}>
                Send
              </Button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5">
            {!isWorking && session.status !== 'complete' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => void requestVerify()}
                >
                  Reload & Verify
                </Button>
                <Button
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={approveAndComplete}
                >
                  Approve
                </Button>
              </>
            )}

            {session.status === 'complete' && (
              <div className="w-full text-center">
                <p className="mb-1 text-xs text-green-300">Review session complete</p>
                <Button size="sm" variant="outline" className="text-xs" onClick={cancelReview}>
                  New Review
                </Button>
              </div>
            )}

            {isWorking && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs text-red-400 hover:text-red-300"
                onClick={cancelReview}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      )}

      {/* Completed but not started new */}
      {!session.active && session.status === 'complete' && (
        <div className="space-y-2 text-center">
          <p className="text-xs text-green-300">Previous review completed</p>
          <Button size="sm" className="w-full" onClick={onStartReview}>
            Start New Review
          </Button>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: ReviewIssue }) {
  const severity = SEVERITY_BADGE[issue.severity] ?? SEVERITY_BADGE.minor;
  const status = STATUS_BADGE[issue.status] ?? STATUS_BADGE.open;

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1">
      <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${severity.bg} ${severity.text}`}>
        {issue.severity}
      </span>
      <span className="flex-1 truncate text-[11px] text-white/70" title={issue.description}>
        {issue.description}
      </span>
      <span className={`rounded px-1 py-0.5 text-[9px] ${status.bg} ${status.text}`}>
        {status.label}
      </span>
    </div>
  );
}
