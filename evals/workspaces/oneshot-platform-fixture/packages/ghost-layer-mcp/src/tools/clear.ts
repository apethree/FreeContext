import { clearAnnotations, getPage } from '../browser.js';

export async function clearAnnotationsTool() {
  const cleared = clearAnnotations();

  // Remove overlay from page
  try {
    const page = await getPage();
    await page.evaluate(() => {
      const overlay = document.getElementById('__ghost_layer_overlay');
      if (overlay) overlay.remove();
    });
  } catch {
    // Page might not be available
  }

  return {
    cleared,
    status: 'cleared',
  };
}
