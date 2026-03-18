import type { AnnotationShape, Viewport } from './types.js';
import { buildCurvedConnector } from './connector.js';
import { estimateConnectedLabelMetrics } from './label-layout.js';

/**
 * Generate an SVG overlay string from annotations.
 * This can be composited over a screenshot in any environment
 * (browser Canvas, Node sharp/canvas, Playwright page.evaluate).
 */
export function renderAnnotationsSvg(
  annotations: AnnotationShape[],
  viewport: Viewport,
): string {
  const { width, height } = viewport;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ];

  // Render connector lines behind shapes.
  for (const shape of annotations) {
    if (shape.type !== 'text' || !shape.parentId) continue;
    const parent = annotations.find((candidate) => candidate.id === shape.parentId);
    if (!parent) continue;
    const connector = buildCurvedConnector({
      parent,
      text: shape,
      annotations,
    });
    const color = parent.color;
    parts.push(
      `<path d="${connector.path}" stroke="${color}" stroke-width="2" opacity="0.75" fill="none" stroke-dasharray="5 3" stroke-linecap="round"/>`,
      `<circle cx="${connector.to.x}" cy="${connector.to.y}" r="4" fill="${color}" opacity="0.85"/>`,
    );
  }

  for (const shape of annotations) {
    const stroke = shape.color;
    const sw = 3;

    switch (shape.type) {
      case 'circle':
        parts.push(
          `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" stroke="${stroke}" stroke-width="${sw}" fill="none" opacity="0.85"/>`,
        );
        break;
      case 'rect':
        parts.push(
          `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" stroke="${stroke}" stroke-width="${sw}" fill="none" opacity="0.85"/>`,
        );
        break;
      case 'arrow': {
        const dx = shape.to.x - shape.from.x;
        const dy = shape.to.y - shape.from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        parts.push(
          `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${stroke}" stroke-width="${sw}" opacity="0.85"/>`,
        );
        if (len > 0) {
          const ux = dx / len;
          const uy = dy / len;
          const hl = Math.min(14, len * 0.3);
          const lx = shape.to.x - hl * (ux + uy * 0.4);
          const ly = shape.to.y - hl * (uy - ux * 0.4);
          const rx = shape.to.x - hl * (ux - uy * 0.4);
          const ry = shape.to.y - hl * (uy + ux * 0.4);
          parts.push(
            `<polygon points="${shape.to.x},${shape.to.y} ${lx},${ly} ${rx},${ry}" fill="${stroke}" opacity="0.85"/>`,
          );
        }
        break;
      }
      case 'line':
        parts.push(
          `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" stroke="${stroke}" stroke-width="${sw}" opacity="0.85"/>`,
        );
        break;
      case 'text':
        if (shape.parentId) {
          const metrics = estimateConnectedLabelMetrics(shape.content);
          const rectX = shape.x - metrics.paddingX;
          const rectY = shape.y - metrics.baselineY;
          parts.push(
            `<rect x="${rectX}" y="${rectY}" width="${metrics.width}" height="${metrics.height}" rx="8" fill="rgba(255,255,255,0.78)" stroke="rgba(15,23,42,0.22)" stroke-width="1" opacity="0.98"/>`,
            `<text x="${shape.x}" y="${shape.y}" fill="#111827" font-size="12" font-family="system-ui, sans-serif" font-weight="600" opacity="0.98">${escapeXml(shape.content)}</text>`,
          );
        } else {
          parts.push(
            `<text x="${shape.x}" y="${shape.y}" fill="${stroke}" font-size="16" font-family="system-ui, sans-serif" opacity="0.9">${escapeXml(shape.content)}</text>`,
          );
        }
        break;
      case 'freehand': {
        if (shape.points.length < 2) break;
        const d = shape.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(' ');
        parts.push(
          `<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
        );
        break;
      }
      case 'snapshot':
        if (shape.x !== shape.originX || shape.y !== shape.originY) {
          parts.push(
            `<rect x="${shape.originX}" y="${shape.originY}" width="${shape.w}" height="${shape.h}" fill="white" opacity="0.85" rx="2"/>`,
          );
        }
        if (shape.imageDataUrl) {
          parts.push(
            `<image href="${escapeXml(shape.imageDataUrl)}" x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"/>`,
            `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" stroke="${stroke}" stroke-width="2" fill="none" opacity="0.7" rx="2"/>`,
          );
        } else {
          parts.push(
            `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" stroke="${stroke}" stroke-width="2" fill="${stroke}18" stroke-dasharray="6 3" opacity="0.85" rx="4"/>`,
          );
        }
        break;
    }

    // Render note label near shape
    if (shape.note) {
      const pos = getNoteLabelPosition(shape);
      parts.push(
        `<rect x="${pos.x - 2}" y="${pos.y - 12}" width="${Math.min(shape.note.length * 7, 200)}" height="16" rx="3" fill="rgba(0,0,0,0.75)"/>`,
        `<text x="${pos.x}" y="${pos.y}" fill="white" font-size="11" font-family="system-ui, sans-serif">${escapeXml(shape.note.slice(0, 30))}${shape.note.length > 30 ? '...' : ''}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function getNoteLabelPosition(shape: AnnotationShape): { x: number; y: number } {
  switch (shape.type) {
    case 'circle':
      return { x: shape.cx - shape.r, y: shape.cy - shape.r - 4 };
    case 'rect':
      return { x: shape.x, y: shape.y - 4 };
    case 'arrow':
    case 'line':
      return { x: shape.from.x, y: shape.from.y - 4 };
    case 'text':
      return { x: shape.x, y: shape.y - 4 };
    case 'freehand': {
      const first = shape.points[0];
      return first ? { x: first.x, y: first.y - 4 } : { x: 0, y: 0 };
    }
    case 'snapshot':
      return { x: shape.x, y: shape.y - 4 };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
