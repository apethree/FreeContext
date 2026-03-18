import { describe, expect, it } from 'vitest';
import { resolveShellView } from '@/features/app/shellRoutes';

describe('resolveShellView', () => {
  it('maps global assistant route to dedicated section', () => {
    const view = resolveShellView('/home/global-assistant');
    expect(view.section).toBe('global-assistant');
    expect(view.pageTitle).toBe('Global Assistant');
  });

  it('keeps assistant alias route pointed at the global assistant section', () => {
    const view = resolveShellView('/home/assistant-chat');
    expect(view.section).toBe('home');
    expect(view.pageTitle).toBe('Home');
  });

  it('maps style lab route to dedicated section', () => {
    const view = resolveShellView('/home/style-lab');
    expect(view.section).toBe('style-lab');
    expect(view.pageTitle).toBe('Style Lab');
  });
});
