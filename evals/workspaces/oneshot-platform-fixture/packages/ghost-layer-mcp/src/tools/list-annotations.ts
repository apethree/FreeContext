import { getAnnotations } from '../browser.js';

export async function listAnnotationsTool() {
  const annotations = getAnnotations();
  return {
    annotations,
    count: annotations.length,
  };
}
