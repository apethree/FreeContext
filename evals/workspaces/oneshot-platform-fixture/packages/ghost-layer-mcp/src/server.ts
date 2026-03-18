#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { navigateSchema, navigateTool } from './tools/navigate.js';
import { screenshotSchema, screenshotTool } from './tools/screenshot.js';
import { annotateSchema, annotateTool } from './tools/annotate.js';
import { annotateElementSchema, annotateElementTool } from './tools/annotate_element.js';
import { listAnnotationsTool } from './tools/list-annotations.js';
import { clearAnnotationsTool } from './tools/clear.js';
import { exportSchema, exportTool } from './tools/export.js';
import { highlightSchema, highlightTool } from './tools/highlight.js';
import {
  reviewStartSchema, reviewStartTool,
  reviewAddIssueSchema, reviewAddIssueTool,
  reviewPlanFixesTool,
  reviewMarkFixedSchema, reviewMarkFixedTool,
  reviewVerifyTool,
  reviewMarkVerifiedSchema, reviewMarkVerifiedTool,
  reviewCompleteTool,
  reviewStatusTool,
} from './tools/review-session.js';
import { closeBrowser } from './browser.js';

const server = new McpServer({
  name: 'ghost-layer',
  version: '0.1.0',
});

// ghost_navigate — Navigate to a URL
server.tool(
  'ghost_navigate',
  'Navigate the browser to a URL. Use this to load a page before annotating it.',
  {
    url: navigateSchema.shape.url,
    waitUntil: navigateSchema.shape.waitUntil,
    adaptOfficeDocs: navigateSchema.shape.adaptOfficeDocs,
  },
  async (args) => {
    const result = await navigateTool(navigateSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_screenshot — Capture a screenshot of the current page
server.tool(
  'ghost_screenshot',
  'Capture a screenshot of the current page, including any annotations. Returns base64 PNG.',
  { fullPage: screenshotSchema.shape.fullPage },
  async (args) => {
    const result = await screenshotTool(screenshotSchema.parse(args));
    return {
      content: [
        {
          type: 'image',
          data: result.screenshot,
          mimeType: result.mimeType,
        },
      ],
    };
  },
);

// ghost_annotate — Add an annotation at specific coordinates
server.tool(
  'ghost_annotate',
  'Add an annotation (circle, rect, arrow, line, text, freehand) at specific pixel coordinates on the page. Use this to mark issues, suggestions, or points of interest.',
  {
    type: annotateSchema.shape.type,
    coords: annotateSchema.shape.coords,
    note: annotateSchema.shape.note,
    color: annotateSchema.shape.color,
    content: annotateSchema.shape.content,
  },
  async (args) => {
    const result = await annotateTool(annotateSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_annotate_element — Annotate an element by CSS selector
server.tool(
  'ghost_annotate_element',
  'Annotate a page element by CSS selector. Automatically finds the element bounding box and draws an annotation around it.',
  {
    selector: annotateElementSchema.shape.selector,
    note: annotateElementSchema.shape.note,
    type: annotateElementSchema.shape.type,
    color: annotateElementSchema.shape.color,
  },
  async (args) => {
    const result = await annotateElementTool(annotateElementSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_highlight_element — Highlight an element with CSS border
server.tool(
  'ghost_highlight_element',
  'Highlight page elements matching a CSS selector with a colored outline. Useful for quick visual emphasis without creating an annotation.',
  {
    selector: highlightSchema.shape.selector,
    color: highlightSchema.shape.color,
  },
  async (args) => {
    const result = await highlightTool(highlightSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_list_annotations — List all current annotations
server.tool(
  'ghost_list_annotations',
  'List all annotations currently placed on the page.',
  {},
  async () => {
    const result = await listAnnotationsTool();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_clear_annotations — Remove all annotations
server.tool(
  'ghost_clear_annotations',
  'Remove all annotations from the page.',
  {},
  async () => {
    const result = await clearAnnotationsTool();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_export — Export annotations as W3C JSON-LD + screenshot
server.tool(
  'ghost_export',
  'Export all annotations as W3C Web Annotation JSON-LD along with an annotated screenshot. Use this to produce structured output for review or further processing.',
  { format: exportSchema.shape.format },
  async (args) => {
    const result = await exportTool(exportSchema.parse(args));
    return {
      content: [
        { type: 'text', text: result.jsonld },
        {
          type: 'image',
          data: result.screenshot,
          mimeType: result.screenshotMimeType,
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// Review Session Tools — Structured review-fix-verify loop
// ---------------------------------------------------------------------------

// ghost_review_start — Begin a review session on a URL
server.tool(
  'ghost_review_start',
  'Start a structured review session on a URL. Navigates to the page, takes a screenshot, and prepares for issue identification. Use this to begin a review-fix-verify loop.',
  {
    url: reviewStartSchema.shape.url,
    maxIterations: reviewStartSchema.shape.maxIterations,
    categories: reviewStartSchema.shape.categories,
  },
  async (args) => {
    const result = await reviewStartTool(reviewStartSchema.parse(args));
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...result, screenshot: undefined, screenshotMimeType: undefined }, null, 2) },
        { type: 'image', data: result.screenshot, mimeType: result.screenshotMimeType },
      ],
    };
  },
);

// ghost_review_add_issue — Add an issue to the current review session
server.tool(
  'ghost_review_add_issue',
  'Add a UI issue to the current review session. Provide description, severity, category, and either coordinates or a CSS selector. The issue will be annotated on the page.',
  {
    description: reviewAddIssueSchema.shape.description,
    severity: reviewAddIssueSchema.shape.severity,
    category: reviewAddIssueSchema.shape.category,
    annotationType: reviewAddIssueSchema.shape.annotationType,
    coords: reviewAddIssueSchema.shape.coords,
    selector: reviewAddIssueSchema.shape.selector,
    color: reviewAddIssueSchema.shape.color,
  },
  async (args) => {
    const result = await reviewAddIssueTool(reviewAddIssueSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_review_plan_fixes — Finalize issues and get annotated screenshot with fix plan
server.tool(
  'ghost_review_plan_fixes',
  'Finalize the issue list for the current iteration. Returns an annotated screenshot and prioritized list of issues to fix. Call this after adding all issues.',
  {},
  async () => {
    const result = await reviewPlanFixesTool();
    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      { type: 'text', text: JSON.stringify({ ...result, annotatedScreenshot: undefined, screenshotMimeType: undefined }, null, 2) },
    ];
    if (result.annotatedScreenshot) {
      content.push({ type: 'image', data: result.annotatedScreenshot, mimeType: result.screenshotMimeType! });
    }
    return { content: content as any };
  },
);

// ghost_review_mark_fixed — Mark an issue as fixed after code changes
server.tool(
  'ghost_review_mark_fixed',
  'Mark an issue as fixed after making code changes. Call this for each issue you fix before running ghost_review_verify.',
  {
    issueId: reviewMarkFixedSchema.shape.issueId,
    fixDescription: reviewMarkFixedSchema.shape.fixDescription,
  },
  async (args) => {
    const result = await reviewMarkFixedTool(reviewMarkFixedSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_review_verify — Reload page and verify fixes
server.tool(
  'ghost_review_verify',
  'Reload the page after making fixes and take a fresh screenshot for verification. Use this to check if your code changes actually fixed the issues.',
  {},
  async () => {
    const result = await reviewVerifyTool();
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ...result, screenshot: undefined, screenshotMimeType: undefined }, null, 2) },
        { type: 'image', data: result.screenshot, mimeType: result.screenshotMimeType },
      ],
    };
  },
);

// ghost_review_mark_verified — Confirm a fix is verified after page reload
server.tool(
  'ghost_review_mark_verified',
  'Confirm that a previously fixed issue is actually resolved after page reload. Call this during verification for each issue that looks fixed.',
  {
    issueId: reviewMarkVerifiedSchema.shape.issueId,
  },
  async (args) => {
    const result = await reviewMarkVerifiedTool(reviewMarkVerifiedSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// ghost_review_complete — Finalize the review session with a report
server.tool(
  'ghost_review_complete',
  'Complete the review session and generate a final report with before/after screenshots and issue summary. Call this when all issues are addressed or the review is done.',
  {},
  async () => {
    const result = await reviewCompleteTool();
    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      { type: 'text', text: JSON.stringify({ ...result, beforeScreenshot: undefined, afterScreenshot: undefined, screenshotMimeType: undefined }, null, 2) },
    ];
    if (result.beforeScreenshot) {
      content.push({ type: 'image', data: result.beforeScreenshot, mimeType: result.screenshotMimeType! });
    }
    if (result.afterScreenshot) {
      content.push({ type: 'image', data: result.afterScreenshot, mimeType: result.screenshotMimeType! });
    }
    return { content: content as any };
  },
);

// ghost_review_status — Check current review session status
server.tool(
  'ghost_review_status',
  'Get the current review session status, including issue counts by state.',
  {},
  async () => {
    const result = await reviewStatusTool();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);

// Graceful shutdown
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Ghost Layer MCP server failed to start:', err);
  process.exit(1);
});
