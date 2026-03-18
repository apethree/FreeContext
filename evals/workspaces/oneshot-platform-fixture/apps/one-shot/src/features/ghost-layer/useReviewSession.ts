import { useAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayChatAttachment, GatewayPushEvent } from '@/gateway/demoTypes';
import { reviewSessionAtom, type ReviewIssue } from './review-state';
import type { AnnotationSessionExportV2 } from '@oneshot/annotation-core/types';

type ReviewSessionOptions = {
  provider: 'openai' | 'anthropic' | 'gemini';
  runtime: 'local' | 'cloud' | 'auto';
  model: string;
};

export function useReviewSession(options: ReviewSessionOptions) {
  const [session, setSession] = useAtom(reviewSessionAtom);
  const [error, setError] = useState<string | null>(null);
  const sessionKeyRef = useRef<string>('');

  // Listen for agent responses
  useEffect(() => {
    const unsubscribe = window.appShell.onGatewayEvent((event: GatewayPushEvent) => {
      if (event.type !== 'chat') return;
      const payload = event.payload as Record<string, unknown> | null;
      if (!payload) return;
      if (payload.sessionKey !== sessionKeyRef.current) return;

      const messageRaw = payload.message as { role?: string; text?: string } | undefined;
      const text = messageRaw?.text ?? '';
      const state = payload.state as string | undefined;

      if (state === 'final' && text.trim()) {
        // Try to extract issues from agent response
        const extractedIssues = parseIssuesFromResponse(text);

        setSession((prev) => ({
          ...prev,
          agentMessages: [...prev.agentMessages, text],
          issues: extractedIssues.length > 0
            ? [...prev.issues, ...extractedIssues.filter((ni) => !prev.issues.some((ei) => ei.id === ni.id))]
            : prev.issues,
          status: prev.status === 'sending' || prev.status === 'waiting' ? 'fixing' : prev.status,
        }));
      }

      if (state === 'error') {
        setError(payload.errorMessage as string ?? 'Agent error');
        setSession((prev) => ({ ...prev, status: 'reviewing' }));
      }
    });

    return () => unsubscribe();
  }, [setSession]);

  const startReview = useCallback(async (payload: AnnotationSessionExportV2) => {
    const sessionId = `ghost-review-${Date.now()}`;
    sessionKeyRef.current = sessionId;

    const primaryResourceUrl = payload.resources[0]?.sourceUrl ?? '';
    const annotationCount = payload.annotations.length;

    setSession({
      active: true,
      sessionId,
      url: primaryResourceUrl,
      iteration: 1,
      maxIterations: 5,
      status: 'sending',
      issues: [],
      agentMessages: [],
    });
    setError(null);

    const prompt = annotationCount > 0
      ? `I have a Ghost Layer multi-resource annotation session with ${payload.steps.length} step(s) across ${payload.resources.length} resource(s). Use this structured Session JSON v2 payload to review and fix issues:\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nPlease process steps in order, identify required code/design changes, and report what you fixed.`
      : `Please review the current surface(s) and identify UI/UX issues. Focus on layout, accessibility, responsiveness, and visual consistency.`;

    try {
      const result = await window.appShell.pipelineChatSend({
        provider: options.provider,
        runtime: options.runtime,
        model: options.model,
        sessionId,
        message: prompt,
        idempotencyKey: `review-${Date.now()}`,
      });

      if (!result.ok) {
        setError(result.error ?? 'Failed to send review request');
        setSession((prev) => ({ ...prev, status: 'reviewing' }));
      } else {
        setSession((prev) => ({ ...prev, status: 'waiting' }));
      }
    } catch (err) {
      setError(String(err));
      setSession((prev) => ({ ...prev, status: 'reviewing' }));
    }
  }, [options.model, options.provider, options.runtime, setSession]);

  const sendFollowUp = useCallback(async (message: string, attachments?: GatewayChatAttachment[]) => {
    if (!session.active || !sessionKeyRef.current) return;

    setSession((prev) => ({ ...prev, status: 'sending' }));

    try {
      const result = await window.appShell.pipelineChatSend({
        provider: options.provider,
        runtime: options.runtime,
        model: options.model,
        sessionId: sessionKeyRef.current,
        message,
        attachments,
        idempotencyKey: `review-followup-${Date.now()}`,
      });

      if (!result.ok) {
        setError(result.error ?? 'Failed to send follow-up');
        setSession((prev) => ({ ...prev, status: 'reviewing' }));
      } else {
        setSession((prev) => ({ ...prev, status: 'waiting' }));
      }
    } catch (err) {
      setError(String(err));
      setSession((prev) => ({ ...prev, status: 'reviewing' }));
    }
  }, [session.active, options, setSession]);

  const requestVerify = useCallback(async () => {
    if (!session.active) return;

    setSession((prev) => ({
      ...prev,
      status: 'verifying',
      iteration: prev.iteration + 1,
    }));

    await sendFollowUp(
      'I have reloaded and re-validated the annotated surfaces. Please verify whether all previously tracked issues are resolved and list any remaining gaps.',
    );
  }, [session.active, setSession, sendFollowUp]);

  const approveAndComplete = useCallback(() => {
    setSession((prev) => ({
      ...prev,
      active: false,
      status: 'complete',
    }));
    sessionKeyRef.current = '';
  }, [setSession]);

  const cancelReview = useCallback(() => {
    setSession({
      active: false,
      sessionId: '',
      url: '',
      iteration: 0,
      maxIterations: 5,
      status: 'idle',
      issues: [],
      agentMessages: [],
    });
    sessionKeyRef.current = '';
    setError(null);
  }, [setSession]);

  const updateIssueStatus = useCallback((issueId: string, status: ReviewIssue['status']) => {
    setSession((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, status } : i)),
    }));
  }, [setSession]);

  return {
    session,
    error,
    startReview,
    sendFollowUp,
    requestVerify,
    approveAndComplete,
    cancelReview,
    updateIssueStatus,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let issueCounter = 0;

/**
 * Best-effort extraction of issues from agent text responses.
 * Looks for JSON blocks with issue arrays or numbered issue patterns.
 */
function parseIssuesFromResponse(text: string): ReviewIssue[] {
  // Try JSON block first
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const items = Array.isArray(parsed) ? parsed : parsed?.issues;
      if (Array.isArray(items)) {
        return items
          .filter((item: Record<string, unknown>) => item.description || item.issue)
          .map((item: Record<string, unknown>) => {
            issueCounter += 1;
            return {
              id: `ui-issue-${issueCounter}`,
              description: String(item.description ?? item.issue ?? ''),
              severity: normalizeSeverity(String(item.severity ?? 'minor')),
              category: String(item.category ?? 'general'),
              status: 'open' as const,
              annotationId: '',
            };
          });
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // Fallback: numbered list pattern like "1. **Issue**: description"
  const lines = text.split('\n');
  const issues: ReviewIssue[] = [];
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+\*{0,2}(.+?)\*{0,2}[:\-–]\s*(.+)/);
    if (match && match[2].length > 10) {
      issueCounter += 1;
      issues.push({
        id: `ui-issue-${issueCounter}`,
        description: match[2].trim(),
        severity: 'minor',
        category: 'general',
        status: 'open',
        annotationId: '',
      });
    }
  }
  return issues;
}

function normalizeSeverity(raw: string): ReviewIssue['severity'] {
  const lower = raw.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'major' || lower === 'high') return 'major';
  if (lower === 'suggestion' || lower === 'info' || lower === 'low') return 'suggestion';
  return 'minor';
}
