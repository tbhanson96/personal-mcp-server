#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const EXIT_HANDOFF = 20;
const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

class HandoffRequiredError extends Error {}

export function compareManifests(before, after) {
  const beforeTools = new Map((before.tools ?? []).map((tool) => [tool.name, tool]));
  const afterTools = new Map((after.tools ?? []).map((tool) => [tool.name, tool]));
  const added = [...afterTools.keys()].filter((name) => !beforeTools.has(name)).sort();
  const removed = [...beforeTools.keys()].filter((name) => !afterTools.has(name)).sort();
  const changed = [...afterTools.keys()]
    .filter((name) => beforeTools.has(name) && stableJson(beforeTools.get(name)) !== stableJson(afterTools.get(name)))
    .sort();
  const changedFields = Object.fromEntries(changed.map((name) => {
    const beforeTool = beforeTools.get(name);
    const afterTool = afterTools.get(name);
    const keys = new Set([...Object.keys(beforeTool), ...Object.keys(afterTool)]);
    return [name, [...keys].filter((key) => stableJson(beforeTool[key]) !== stableJson(afterTool[key])).sort()];
  }));
  return { added, removed, changed, changedFields, hasChanges: added.length + removed.length + changed.length > 0 };
}

export function environmentFindings({ executablePath, profileDir, headless, display = process.env.DISPLAY, wayland = process.env.WAYLAND_DISPLAY }) {
  const findings = [];
  if (!executablePath) findings.push('Playwright Chromium is not installed; run: npx playwright install chromium');
  if (!profileDir) findings.push('A dedicated persistent profile directory is required.');
  if (!headless && !display && !wayland) findings.push('No graphical display is available; run from an interactive desktop or explicitly opt into headless mode after manual profile setup.');
  return findings;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profileDir = path.resolve(expandHome(options.profileDir ?? process.env.PERSONAL_MCP_CHATGPT_PROFILE_DIR ?? '~/.config/chromium'));
  const configuredExecutablePath = options.executablePath ?? process.env.PERSONAL_MCP_CHATGPT_EXECUTABLE_PATH;
  const pluginName = options.pluginName ?? process.env.PERSONAL_MCP_CHATGPT_PLUGIN_NAME ?? 'Personal MCP';
  const headless = process.env.PERSONAL_MCP_CHATGPT_HEADLESS === undefined
    ? options.headless
    : process.env.PERSONAL_MCP_CHATGPT_HEADLESS === '1';

  if (options.checkEnvironment) {
    const playwright = await loadPlaywright();
    const executablePath = await resolveExecutablePath(configuredExecutablePath, playwright);
    const findings = environmentFindings({ executablePath, profileDir, headless });
    const profileExists = await stat(profileDir).then((value) => value.isDirectory()).catch(() => false);
    const report = { browserInstalled: Boolean(executablePath), graphicalDisplay: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY), headless, profileDirectory: profileDir, profileExists, ready: findings.length === 0 && profileExists, findings };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : EXIT_HANDOFF;
    return;
  }

  if (options.setupProfile) {
    const playwright = await loadPlaywright();
    const executablePath = await resolveExecutablePath(configuredExecutablePath, playwright);
    const findings = environmentFindings({ executablePath, profileDir, headless });
    if (findings.length > 0) return handoff(findings.join(' '));
    if (headless) return handoff('Profile setup requires a headed interactive browser so the operator can sign in manually.');
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    await chmod(profileDir, 0o700);
    const context = await playwright.chromium.launchPersistentContext(profileDir, browserLaunchOptions({ headless: false, executablePath, configuredExecutablePath }));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(CHATGPT_PLUGINS_URL, { waitUntil: 'domcontentloaded' });
    console.error('Browser opened. Sign in and complete CAPTCHA/MFA manually if needed, confirm the Personal MCP plugin is visible, then close the browser.');
    await new Promise((resolve) => context.once('close', resolve));
    return;
  }

  if (options.probeProfile) {
    const playwright = await loadPlaywright();
    const executablePath = await resolveExecutablePath(configuredExecutablePath, playwright);
    const findings = environmentFindings({ executablePath, profileDir, headless });
    if (findings.length > 0) return handoff(findings.join(' '));
    const profileExists = await stat(profileDir).then((value) => value.isDirectory()).catch(() => false);
    if (!profileExists) return handoff('The persistent browser profile does not exist.');
    await probeProfile({ playwright, profileDir, pluginName, headless, executablePath, configuredExecutablePath, artifactDir: options.artifactDir });
    return;
  }

  if (!options.beforeManifest || !options.afterManifest) usageError('Both --before-manifest and --after-manifest are required.');
  const before = await readJson(options.beforeManifest);
  const after = await readJson(options.afterManifest);
  const difference = compareManifests(before, after);
  const evidence = {
    beforeSha256: sha256(stableJson(before)),
    afterSha256: sha256(stableJson(after)),
    ...difference,
    pluginName,
    newConversationRequired: difference.hasChanges,
  };
  if (!difference.hasChanges) {
    console.log(JSON.stringify({ outcome: 'skipped_no_tool_changes', ...evidence }, null, 2));
    return;
  }

  const playwright = await loadPlaywright();
  const executablePath = await resolveExecutablePath(configuredExecutablePath, playwright);
  const findings = environmentFindings({ executablePath, profileDir, headless });
  if (findings.length > 0) return handoff(findings.join(' '));
  const profileExists = await stat(profileDir).then((value) => value.isDirectory()).catch(() => false);
  if (!profileExists) return handoff('The persistent browser profile is not initialized. Point PERSONAL_MCP_CHATGPT_PROFILE_DIR at a user-controlled, already authenticated Chromium profile or initialize the dedicated profile manually.');

  const artifactDir = path.resolve(expandHome(options.artifactDir ?? `~/.local/state/personal-mcp-server/chatgpt-refresh/${new Date().toISOString().replaceAll(':', '-')}`));
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await chmod(artifactDir, 0o700);
  const reportPath = path.join(artifactDir, 'report.json');
  let context;
  let page;
  try {
    context = await playwright.chromium.launchPersistentContext(profileDir, browserLaunchOptions({ headless, executablePath, configuredExecutablePath }));
    page = context.pages()[0] ?? await context.newPage();
    await page.goto(CHATGPT_PLUGINS_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForChatGptUi(page);

    if (await requiresLogin(page)) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'login_required', ...evidence });
      await failureScreenshot(page, artifactDir);
      return handoff('The persistent browser profile is not authenticated with ChatGPT. Sign in manually outside this automation, then retry the headless run.');
    }

    const pluginTarget = await waitForPluginTarget(page, pluginName);
    if (!pluginTarget) throw new Error(`Could not find the ${pluginName} connection using semantic locators.`);
    await pluginTarget.click();

    const refreshButton = await firstVisible([
      page.getByRole('button', { name: /^refresh tools$/i }),
      page.getByRole('button', { name: /^refresh$/i }),
      page.getByRole('button', { name: /refresh (metadata|connection)/i }),
    ]);
    if (!refreshButton) throw new Error('Could not find the connection Refresh tools button using semantic locators.');
    await refreshButton.click();

    const confirmation = page.getByRole('dialog');
    await confirmation.first().waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
    if (await confirmation.isVisible().catch(() => false)) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'confirmation_required', ...evidence });
      await failureScreenshot(page, artifactDir);
      return handoff('ChatGPT opened a confirmation dialog. Review and confirm it manually, then rerun verification; the automation will not approve dialogs.');
    }

    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    const toolsDisclosure = await firstVisible([
      page.getByRole('button', { name: /^tools$/i }),
      page.getByRole('button', { name: /view tools/i }),
    ]);
    if (toolsDisclosure) await toolsDisclosure.click().catch(() => undefined);

    const missingAdded = [];
    for (const toolName of difference.added) {
      const visible = await page.getByText(toolName, { exact: true }).first().isVisible().catch(() => false);
      if (!visible) missingAdded.push(toolName);
    }
    if (missingAdded.length > 0) throw new Error(`New tool names were not visible after refresh: ${missingAdded.join(', ')}`);

    const stillVisibleRemoved = [];
    for (const toolName of difference.removed) {
      const visible = await page.getByText(toolName, { exact: true }).first().isVisible().catch(() => false);
      if (visible) stillVisibleRemoved.push(toolName);
    }
    if (stillVisibleRemoved.length > 0) throw new Error(`Removed tool names were still visible after refresh: ${stillVisibleRemoved.join(', ')}`);

    const unverifiedChanged = [];
    for (const toolName of difference.changed) {
      const tool = after.tools.find((candidate) => candidate.name === toolName);
      const nameVisible = await page.getByText(toolName, { exact: true }).first().isVisible().catch(() => false);
      const fields = difference.changedFields[toolName];
      const onlyVisibleFields = fields.every((field) => ['description', 'title'].includes(field));
      const probes = fields
        .map((field) => tool?.[field])
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim().slice(0, 80));
      const probesVisible = probes.length > 0 && (await Promise.all(probes.map((probe) => (
        page.getByText(probe, { exact: false }).first().isVisible().catch(() => false)
      )))).every(Boolean);
      if (!nameVisible || !onlyVisibleFields || !probesVisible) unverifiedChanged.push(toolName);
    }
    if (unverifiedChanged.length > 0) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'schema_detail_not_visible', unverifiedChanged, ...evidence });
      await failureScreenshot(page, artifactDir);
      return handoff(`Refresh ran, but ChatGPT did not expose enough metadata to verify: ${unverifiedChanged.join(', ')}. Confirm those tool details manually in the connection UI.`);
    }

    await writeReport(reportPath, { outcome: 'refreshed', verifiedAdded: difference.added, verifiedChanged: difference.changed, ...evidence });
    console.log(JSON.stringify({ outcome: 'refreshed', reportPath, ...evidence }, null, 2));
    console.error('Start a new ChatGPT conversation and rerun the affected plugin tests; existing conversations may retain stale tools.');
  } catch (error) {
    if (page) await failureScreenshot(page, artifactDir);
    if (error instanceof HandoffRequiredError) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'human_verification_required', ...evidence });
      return handoff(error.message);
    }
    await writeReport(reportPath, { outcome: 'verification_failed', error: safeError(error), ...evidence });
    console.error(`ChatGPT refresh verification failed: ${safeError(error)}`);
    console.error(`Private evidence: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function requiresLogin(page) {
  if (!page.url().startsWith('https://chatgpt.com/')) return true;
  return (await page.getByRole('button', { name: /log in|sign up/i }).count()) > 0;
}

async function waitForChatGptUi(page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await hasHumanVerificationChallenge(page)) {
      throw new HandoffRequiredError('ChatGPT presented a human-verification challenge. Complete it manually in a user-controlled browser; the automation will not interact with CAPTCHA.');
    }
    const bodyHasText = await page.locator('body').evaluate((body) => body.innerText.trim().length > 0).catch(() => false);
    if (bodyHasText) return;
    await page.waitForTimeout(500);
  }
  throw new Error('Timed out waiting for the ChatGPT Plugins UI to become ready.');
}

async function hasHumanVerificationChallenge(page) {
  if (await page.getByText(/verify you are human/i).count().catch(() => 0) > 0) return true;
  if (await page.locator('iframe[title*="challenge" i], iframe[title*="verification" i]').count().catch(() => 0) > 0) return true;
  return page.frames().some((frame) => frame.url().startsWith('https://challenges.cloudflare.com/'));
}

async function waitForPluginTarget(page, pluginName, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasHumanVerificationChallenge(page)) {
      throw new HandoffRequiredError('ChatGPT presented a human-verification challenge. Complete it manually in a user-controlled browser; the automation will not interact with CAPTCHA.');
    }
    if (await requiresLogin(page)) return undefined;
    const pluginTarget = await firstVisible([
      page.getByRole('link', { name: pluginName, exact: true }),
      page.getByRole('button', { name: pluginName, exact: true }),
      page.getByText(pluginName, { exact: true }),
    ]);
    if (pluginTarget) return pluginTarget;
    await page.waitForTimeout(500);
  }
  return undefined;
}

async function probeProfile({ playwright, profileDir, pluginName, headless, executablePath, configuredExecutablePath, artifactDir: requestedArtifactDir }) {
  const artifactDir = path.resolve(expandHome(requestedArtifactDir ?? `~/.local/state/personal-mcp-server/chatgpt-refresh/${new Date().toISOString().replaceAll(':', '-')}`));
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await chmod(artifactDir, 0o700);
  const reportPath = path.join(artifactDir, 'report.json');
  let context;
  let page;
  try {
    context = await playwright.chromium.launchPersistentContext(profileDir, browserLaunchOptions({ headless, executablePath, configuredExecutablePath }));
    page = context.pages()[0] ?? await context.newPage();
    await page.goto(CHATGPT_PLUGINS_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForChatGptUi(page);
    if (await requiresLogin(page)) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'login_required', pluginName, headless });
      await failureScreenshot(page, artifactDir);
      return handoff('The persistent browser profile is not authenticated with ChatGPT. Sign in manually outside this automation, then retry the headless probe.');
    }
    const pluginTarget = await waitForPluginTarget(page, pluginName);
    if (!pluginTarget) throw new Error(`Could not find the ${pluginName} connection using semantic locators.`);
    await writeReport(reportPath, { outcome: 'profile_ready', pluginName, headless });
    console.log(JSON.stringify({ outcome: 'profile_ready', pluginName, headless, reportPath }, null, 2));
  } catch (error) {
    if (page) await failureScreenshot(page, artifactDir);
    if (error instanceof HandoffRequiredError) {
      await writeReport(reportPath, { outcome: 'handoff_required', reason: 'human_verification_required', pluginName, headless });
      return handoff(error.message);
    }
    await writeReport(reportPath, { outcome: 'verification_failed', error: safeError(error), pluginName, headless });
    console.error(`Headless ChatGPT profile probe failed: ${safeError(error)}`);
    console.error(`Private evidence: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return undefined;
}

async function failureScreenshot(page, artifactDir) {
  const screenshotPath = path.join(artifactDir, 'failure.png');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await chmod(screenshotPath, 0o600).catch(() => undefined);
}

async function writeReport(reportPath, report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(reportPath, 0o600);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return undefined;
  }
}

async function usableExecutable(candidate) {
  if (!candidate) return undefined;
  return stat(candidate).then((value) => value.isFile() ? candidate : undefined).catch(() => undefined);
}

async function resolveExecutablePath(configuredExecutablePath, playwright) {
  const candidate = configuredExecutablePath
    ? path.resolve(expandHome(configuredExecutablePath))
    : playwright?.chromium?.executablePath?.();
  return usableExecutable(candidate);
}

export function browserLaunchOptions({ headless, executablePath, configuredExecutablePath }) {
  if (!configuredExecutablePath) return { headless };
  return { headless, executablePath, chromiumSandbox: true };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
}

function parseArgs(argv) {
  const parsed = { headless: true, checkEnvironment: false, setupProfile: false, probeProfile: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--headless') parsed.headless = true;
    else if (value === '--headed') parsed.headless = false;
    else if (value === '--check-environment') parsed.checkEnvironment = true;
    else if (value === '--setup-profile') parsed.setupProfile = true;
    else if (value === '--probe-profile') parsed.probeProfile = true;
    else if (['--before-manifest', '--after-manifest', '--profile-dir', '--plugin-name', '--artifact-dir', '--executable-path'].includes(value)) {
      const next = argv[index + 1];
      if (!next) usageError(`${value} requires a value.`);
      parsed[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
      index += 1;
    } else usageError(`Unknown argument: ${value}`);
  }
  return parsed;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Unknown browser automation error';
}

function expandHome(value) {
  return value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function handoff(message) {
  console.error(`User action required: ${message}`);
  process.exitCode = EXIT_HANDOFF;
}

function usageError(message) {
  console.error(message);
  console.error('Usage: refresh-chatgpt-plugin.mjs --before-manifest PATH --after-manifest PATH [--profile-dir PATH] [--plugin-name NAME] [--executable-path PATH] [--headless|--headed]');
  process.exit(2);
  throw new Error(message);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
