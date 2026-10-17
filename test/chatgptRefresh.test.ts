import { describe, expect, it } from 'vitest';
// @ts-expect-error The executable JavaScript skill intentionally has no package declaration.
import { compareManifests, environmentFindings } from '../skills/chatgpt-plugin-refresh/scripts/refresh-chatgpt-plugin.mjs';

describe('ChatGPT plugin refresh guard', () => {
  it('detects added, removed, and metadata-changed tools', () => {
    const before = { tools: [{ name: 'same', description: 'same' }, { name: 'changed', description: 'old' }, { name: 'removed' }] };
    const after = { tools: [{ name: 'same', description: 'same' }, { name: 'changed', description: 'new' }, { name: 'added' }] };
    expect(compareManifests(before, after)).toEqual({
      added: ['added'],
      removed: ['removed'],
      changed: ['changed'],
      changedFields: { changed: ['description'] },
      hasChanges: true,
    });
  });

  it('skips browser work for identical manifests', () => {
    const manifest = { tools: [{ name: 'same', inputSchema: { type: 'object' } }] };
    expect(compareManifests(manifest, structuredClone(manifest)).hasChanges).toBe(false);
  });

  it('requires a browser and graphical session unless headless was explicit', () => {
    expect(environmentFindings({ executablePath: undefined, profileDir: '/profile', headless: false, display: undefined, wayland: undefined })).toEqual([
      'Playwright Chromium is not installed; run: npx playwright install chromium',
      'No graphical display is available; run from an interactive desktop or explicitly opt into headless mode after manual profile setup.',
    ]);
    expect(environmentFindings({ executablePath: '/chromium', profileDir: '/profile', headless: true, display: undefined, wayland: undefined })).toEqual([]);
  });
});
