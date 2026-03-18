import { z } from 'zod';
import { getPage, getAnnotations, addAnnotation, clearAnnotations, getViewport, takeScreenshot, injectAnnotationOverlay } from '../browser.js';
import { serializeToW3C } from '../../../annotation-core/src/serialize.js';
import { DEFAULT_ANNOTATION_COLOR } from '../../../annotation-core/src/types.js';
import type { AnnotationBundle, AnnotationShape } from '../../../annotation-core/src/types.js';

// ---------------------------------------------------------------------------
// Review session state
// ---------------------------------------------------------------------------

export type ReviewIssue = {
  id: string;
  annotation: AnnotationShape;
  description: string;
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  category: string;
  status: 'open' | 'fixing' | 'fixed' | 'verified' | 'wont_fix';
  fixAttempts: number;
};

export type ReviewSession = {
  id: string;
  url: string;
  startedAt: string;
  iteration: number;
  maxIterations: number;
  issues: ReviewIssue[];
  screenshots: { iteration: number; base64: string }[];
  status: 'reviewing' | 'fixing' | 'verifying' | 'complete' | 'needs_approval';
};

let activeSession: ReviewSession | null = null;
let issueIdCounter = 0;

// ---------------------------------------------------------------------------
// ghost_review_start — Begin a review session
// ---------------------------------------------------------------------------

export const reviewStartSchema = z.object({
  url: z.string().url(),
  maxIterations: z.number().int().min(1).max(10).optional(),
  categories: z.array(z.string()).optional(),
});

export type ReviewStartInput = z.infer<typeof reviewStartSchema>;

export async function reviewStartTool(input: ReviewStartInput) {
  const page = await getPage();
  await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Clear any previous annotations
  clearAnnotations();

  const viewport = await getViewport();
  const screenshot = await takeScreenshot();

  activeSession = {
    id: `review_${Date.now()}`,
    url: input.url,
    startedAt: new Date().toISOString(),
    iteration: 1,
    maxIterations: input.maxIterations ?? 5,
    issues: [],
    screenshots: [{ iteration: 0, base64: screenshot.toString('base64') }],
    status: 'reviewing',
  };

  return {
    sessionId: activeSession.id,
    url: page.url(),
    title: await page.title(),
    viewport,
    screenshot: screenshot.toString('base64'),
    screenshotMimeType: 'image/png',
    status: 'reviewing',
    instruction: `You are now reviewing ${input.url}. Analyze the screenshot and identify UI issues. For each issue found, call ghost_review_add_issue with the issue details and coordinates. When done adding issues, call ghost_review_plan_fixes to generate a fix plan.${input.categories ? ` Focus on: ${input.categories.join(', ')}` : ''}`,
  };
}

// ---------------------------------------------------------------------------
// ghost_review_add_issue — Add an issue to the review session
// ---------------------------------------------------------------------------

export const reviewAddIssueSchema = z.object({
  description: z.string().min(1),
  severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
  category: z.string().min(1),
  annotationType: z.enum(['circle', 'rect', 'arrow']).optional(),
  coords: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().optional(),
    h: z.number().optional(),
    r: z.number().optional(),
  }).optional(),
  selector: z.string().optional(),
  color: z.string().optional(),
});

export type ReviewAddIssueInput = z.infer<typeof reviewAddIssueSchema>;

export async function reviewAddIssueTool(input: ReviewAddIssueInput) {
  if (!activeSession) {
    return { error: 'No active review session. Call ghost_review_start first.', status: 'failed' };
  }

  const color = input.color ?? severityColor(input.severity);
  let annotation: AnnotationShape;

  if (input.selector) {
    // Annotate by selector
    const page = await getPage();
    const box = await page.locator(input.selector).first().boundingBox();
    if (!box) {
      return { error: `Element not found: ${input.selector}`, status: 'failed' };
    }
    const shape = addAnnotation({
      type: 'rect',
      x: box.x - 2,
      y: box.y - 2,
      w: box.width + 4,
      h: box.height + 4,
      color,
      note: input.description,
    });
    annotation = shape;
  } else if (input.coords) {
    const type = input.annotationType ?? 'rect';
    let shape: Parameters<typeof addAnnotation>[0];
    if (type === 'circle') {
      shape = {
        type: 'circle',
        cx: input.coords.x,
        cy: input.coords.y,
        r: input.coords.r ?? 25,
        color,
        note: input.description,
      };
    } else {
      shape = {
        type: 'rect',
        x: input.coords.x,
        y: input.coords.y,
        w: input.coords.w ?? 100,
        h: input.coords.h ?? 50,
        color,
        note: input.description,
      };
    }
    annotation = addAnnotation(shape);
  } else {
    return { error: 'Provide either coords or selector', status: 'failed' };
  }

  issueIdCounter += 1;
  const issue: ReviewIssue = {
    id: `issue_${issueIdCounter}`,
    annotation,
    description: input.description,
    severity: input.severity,
    category: input.category,
    status: 'open',
    fixAttempts: 0,
  };

  activeSession.issues.push(issue);
  await injectAnnotationOverlay();

  return {
    issueId: issue.id,
    annotationId: annotation.id,
    severity: issue.severity,
    category: issue.category,
    totalIssues: activeSession.issues.length,
    status: 'added',
  };
}

// ---------------------------------------------------------------------------
// ghost_review_plan_fixes — Finalize issue list, get annotated screenshot
// ---------------------------------------------------------------------------

export async function reviewPlanFixesTool() {
  if (!activeSession) {
    return { error: 'No active review session.', status: 'failed' };
  }

  activeSession.status = 'fixing';

  // Take annotated screenshot
  const screenshot = await takeScreenshot();
  activeSession.screenshots.push({
    iteration: activeSession.iteration,
    base64: screenshot.toString('base64'),
  });

  // Build export
  const viewport = await getViewport();
  const bundle: AnnotationBundle = {
    url: activeSession.url,
    capturedAt: new Date().toISOString(),
    viewport,
    annotations: getAnnotations(),
  };
  const w3c = serializeToW3C(bundle);

  const issuesByPriority = [...activeSession.issues].sort((a, b) => {
    const order = { critical: 0, major: 1, minor: 2, suggestion: 3 };
    return order[a.severity] - order[b.severity];
  });

  return {
    sessionId: activeSession.id,
    iteration: activeSession.iteration,
    totalIssues: activeSession.issues.length,
    issues: issuesByPriority.map((i) => ({
      id: i.id,
      description: i.description,
      severity: i.severity,
      category: i.category,
      status: i.status,
    })),
    annotatedScreenshot: screenshot.toString('base64'),
    screenshotMimeType: 'image/png',
    jsonld: JSON.stringify(w3c, null, 2),
    status: 'ready_to_fix',
    instruction: `Review found ${activeSession.issues.length} issues. Fix them in priority order (critical → major → minor → suggestion). After making code changes, call ghost_review_mark_fixed for each fixed issue, then call ghost_review_verify to reload and re-check.`,
  };
}

// ---------------------------------------------------------------------------
// ghost_review_mark_fixed — Mark an issue as fixed
// ---------------------------------------------------------------------------

export const reviewMarkFixedSchema = z.object({
  issueId: z.string().min(1),
  fixDescription: z.string().optional(),
});

export async function reviewMarkFixedTool(input: z.infer<typeof reviewMarkFixedSchema>) {
  if (!activeSession) {
    return { error: 'No active review session.', status: 'failed' };
  }

  const issue = activeSession.issues.find((i) => i.id === input.issueId);
  if (!issue) {
    return { error: `Issue not found: ${input.issueId}`, status: 'failed' };
  }

  issue.status = 'fixed';
  issue.fixAttempts += 1;

  const remaining = activeSession.issues.filter((i) => i.status === 'open' || i.status === 'fixing');
  return {
    issueId: issue.id,
    status: 'marked_fixed',
    remainingOpen: remaining.length,
    totalIssues: activeSession.issues.length,
    fixedCount: activeSession.issues.filter((i) => i.status === 'fixed' || i.status === 'verified').length,
  };
}

// ---------------------------------------------------------------------------
// ghost_review_verify — Reload page and verify fixes
// ---------------------------------------------------------------------------

export async function reviewVerifyTool() {
  if (!activeSession) {
    return { error: 'No active review session.', status: 'failed' };
  }

  activeSession.status = 'verifying';
  activeSession.iteration += 1;

  // Reload the page to see changes
  const page = await getPage();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Clear old annotations
  clearAnnotations();

  // Take fresh screenshot
  const screenshot = await takeScreenshot();
  activeSession.screenshots.push({
    iteration: activeSession.iteration,
    base64: screenshot.toString('base64'),
  });

  const fixedIssues = activeSession.issues.filter((i) => i.status === 'fixed');
  const openIssues = activeSession.issues.filter((i) => i.status === 'open');
  const allFixed = openIssues.length === 0 && fixedIssues.length > 0;
  const maxReached = activeSession.iteration > activeSession.maxIterations;

  if (allFixed || maxReached) {
    activeSession.status = 'needs_approval';
  } else {
    activeSession.status = 'reviewing';
  }

  return {
    sessionId: activeSession.id,
    iteration: activeSession.iteration,
    maxIterations: activeSession.maxIterations,
    screenshot: screenshot.toString('base64'),
    screenshotMimeType: 'image/png',
    summary: {
      total: activeSession.issues.length,
      fixed: fixedIssues.length,
      verified: activeSession.issues.filter((i) => i.status === 'verified').length,
      open: openIssues.length,
      wontFix: activeSession.issues.filter((i) => i.status === 'wont_fix').length,
    },
    allFixed,
    maxReached,
    status: activeSession.status,
    instruction: allFixed
      ? 'All issues have been marked as fixed. The page has been reloaded. Review the new screenshot to verify the fixes look correct. If everything looks good, call ghost_review_complete. If you spot regressions or remaining issues, call ghost_review_add_issue for new problems found.'
      : maxReached
        ? `Maximum iterations (${activeSession.maxIterations}) reached. Call ghost_review_complete to finalize with current state, or continue fixing remaining issues.`
        : `Iteration ${activeSession.iteration}/${activeSession.maxIterations}. Page reloaded. Review the new screenshot. If previously fixed issues are now verified, call ghost_review_mark_verified. If new issues appear, call ghost_review_add_issue. When done reviewing, call ghost_review_plan_fixes again.`,
  };
}

// ---------------------------------------------------------------------------
// ghost_review_mark_verified — Confirm a fix is verified after reload
// ---------------------------------------------------------------------------

export const reviewMarkVerifiedSchema = z.object({
  issueId: z.string().min(1),
});

export async function reviewMarkVerifiedTool(input: z.infer<typeof reviewMarkVerifiedSchema>) {
  if (!activeSession) {
    return { error: 'No active review session.', status: 'failed' };
  }

  const issue = activeSession.issues.find((i) => i.id === input.issueId);
  if (!issue) {
    return { error: `Issue not found: ${input.issueId}`, status: 'failed' };
  }

  issue.status = 'verified';
  const remaining = activeSession.issues.filter((i) => i.status !== 'verified' && i.status !== 'wont_fix');

  return {
    issueId: issue.id,
    status: 'verified',
    remainingUnverified: remaining.length,
    allVerified: remaining.length === 0,
  };
}

// ---------------------------------------------------------------------------
// ghost_review_complete — Finalize the review session
// ---------------------------------------------------------------------------

export async function reviewCompleteTool() {
  if (!activeSession) {
    return { error: 'No active review session.', status: 'failed' };
  }

  activeSession.status = 'complete';

  // Take final screenshot
  const screenshot = await takeScreenshot();
  activeSession.screenshots.push({
    iteration: activeSession.iteration,
    base64: screenshot.toString('base64'),
  });

  // Build final report
  const viewport = await getViewport();
  const annotations = getAnnotations();
  const bundle: AnnotationBundle = {
    url: activeSession.url,
    capturedAt: new Date().toISOString(),
    viewport,
    annotations,
  };
  const w3c = serializeToW3C(bundle);

  const report = {
    sessionId: activeSession.id,
    url: activeSession.url,
    iterations: activeSession.iteration,
    duration: `${Math.round((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000)}s`,
    summary: {
      total: activeSession.issues.length,
      verified: activeSession.issues.filter((i) => i.status === 'verified').length,
      fixed: activeSession.issues.filter((i) => i.status === 'fixed').length,
      open: activeSession.issues.filter((i) => i.status === 'open').length,
      wontFix: activeSession.issues.filter((i) => i.status === 'wont_fix').length,
    },
    issues: activeSession.issues.map((i) => ({
      id: i.id,
      description: i.description,
      severity: i.severity,
      category: i.category,
      status: i.status,
      fixAttempts: i.fixAttempts,
    })),
    beforeScreenshot: activeSession.screenshots[0]?.base64,
    afterScreenshot: screenshot.toString('base64'),
    screenshotMimeType: 'image/png',
    jsonld: JSON.stringify(w3c, null, 2),
    status: 'complete',
  };

  // Clean up
  const sessionCopy = { ...activeSession };
  activeSession = null;

  return report;
}

// ---------------------------------------------------------------------------
// ghost_review_status — Get current review session status
// ---------------------------------------------------------------------------

export async function reviewStatusTool() {
  if (!activeSession) {
    return { active: false, status: 'no_session' };
  }

  return {
    active: true,
    sessionId: activeSession.id,
    url: activeSession.url,
    iteration: activeSession.iteration,
    maxIterations: activeSession.maxIterations,
    status: activeSession.status,
    summary: {
      total: activeSession.issues.length,
      open: activeSession.issues.filter((i) => i.status === 'open').length,
      fixing: activeSession.issues.filter((i) => i.status === 'fixing').length,
      fixed: activeSession.issues.filter((i) => i.status === 'fixed').length,
      verified: activeSession.issues.filter((i) => i.status === 'verified').length,
      wontFix: activeSession.issues.filter((i) => i.status === 'wont_fix').length,
    },
    issues: activeSession.issues.map((i) => ({
      id: i.id,
      description: i.description,
      severity: i.severity,
      category: i.category,
      status: i.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444'; // red
    case 'major': return '#f97316'; // orange
    case 'minor': return '#eab308'; // yellow
    case 'suggestion': return '#3b82f6'; // blue
    default: return DEFAULT_ANNOTATION_COLOR;
  }
}
