import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error The executable JavaScript skill intentionally has no package declaration.
import { browserLaunchOptions, compareManifests, environmentFindings } from '../skills/chatgpt-plugin-refresh/scripts/refresh-chatgpt-plugin.mjs';

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

  it('uses the matching configured browser with its sandbox enabled', () => {
    expect(browserLaunchOptions({ headless: true, executablePath: '/snap/bin/chromium', configuredExecutablePath: '/snap/bin/chromium' })).toEqual({
      headless: true,
      executablePath: '/snap/bin/chromium',
      chromiumSandbox: true,
    });
    expect(browserLaunchOptions({ headless: false, executablePath: '/bundled/chromium', configuredExecutablePath: undefined })).toEqual({ headless: false });
  });

  it('loads allowlisted host configuration and defaults the wrapper to transient headed mode', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'chatgpt-refresh-config-'));
    try {
      const configPath = path.join(temporaryDirectory, 'refresh.env');
      writeFileSync(configPath, [
        `PERSONAL_MCP_CHATGPT_PROFILE_DIR=${temporaryDirectory}`,
        `PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH=${process.execPath}`,
      ].join('\n'));
      const fakeXvfbRun = path.join(temporaryDirectory, 'xvfb-run');
      writeFileSync(fakeXvfbRun, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'while [[ $# -gt 0 ]]; do',
        '  case $1 in',
        '    -a) shift ;;',
        '    -s) shift 2 ;;',
        '    *) break ;;',
        '  esac',
        'done',
        'export DISPLAY=:77',
        'exec "$@"',
      ].join('\n'));
      chmodSync(fakeXvfbRun, 0o755);
      chmodSync(configPath, 0o600);
      const environment = { ...process.env, PERSONAL_MCP_CHATGPT_CONFIG_FILE: configPath };
      delete environment.PERSONAL_MCP_CHATGPT_HEADLESS;
      delete environment.PERSONAL_MCP_CHATGPT_PROFILE_DIR;
      delete environment.PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH;
      delete environment.DISPLAY;
      environment.PATH = `${temporaryDirectory}:${environment.PATH ?? ''}`;
      const result = spawnSync('bash', ['skills/chatgpt-plugin-refresh/scripts/run-refresh.sh', '--check-environment'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: environment,
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ headless: false, graphicalDisplay: true, profileExists: true, ready: true });

      const headlessResult = spawnSync('bash', ['skills/chatgpt-plugin-refresh/scripts/run-refresh.sh', '--headless', '--check-environment'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: environment,
      });
      expect(headlessResult.status).toBe(0);
      expect(JSON.parse(headlessResult.stdout)).toMatchObject({ headless: true, graphicalDisplay: false, profileExists: true, ready: true });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects unknown host configuration keys', () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'chatgpt-refresh-config-'));
    try {
      const configPath = path.join(temporaryDirectory, 'refresh.env');
      writeFileSync(configPath, 'UNSAFE_UNKNOWN_KEY=value\n');
      const result = spawnSync('bash', ['skills/chatgpt-plugin-refresh/scripts/run-refresh.sh', '--check-environment'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, PERSONAL_MCP_CHATGPT_CONFIG_FILE: configPath },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('unsupported ChatGPT refresh config key');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
