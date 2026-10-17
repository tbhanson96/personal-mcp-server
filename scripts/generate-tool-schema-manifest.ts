#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppConfig } from '../src/config.js';
import { serializeToolSchemaManifest } from '../src/toolSchemaManifest.js';

interface ServerModule {
  createToolDefinitions(config: AppConfig): Parameters<typeof serializeToolSchemaManifest>[0];
}

const args = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(args.sourceRoot ?? path.resolve(import.meta.dirname, '..'));
const serverModuleUrl = pathToFileURL(path.join(sourceRoot, 'src/server.ts')).href;
const { createToolDefinitions } = await import(serverModuleUrl) as ServerModule;
const config: AppConfig = {
  port: 3000,
  bindAddress: '127.0.0.1',
  mcpApiKey: 'manifest-generation-placeholder',
};
const serialized = serializeToolSchemaManifest(createToolDefinitions(config));

if (args.check) {
  const existing = await readFile(args.check, 'utf8').catch(() => '');
  if (existing !== serialized) {
    console.error(`Tool schema manifest is stale: ${args.check}`);
    console.error('Run: npm run tools:manifest:update');
    process.exit(1);
  }
  console.log(`Tool schema manifest is current: ${args.check}`);
} else if (args.write) {
  await writeFile(args.write, serialized, { mode: 0o644 });
  console.log(`Wrote tool schema manifest: ${args.write}`);
} else {
  process.stdout.write(serialized);
}

function parseArgs(argv: string[]) {
  const parsed: { check?: string; write?: string; sourceRoot?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--check' || value === '--write' || value === '--source-root') {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a path`);
      if (value === '--check') parsed.check = next;
      if (value === '--write') parsed.write = next;
      if (value === '--source-root') parsed.sourceRoot = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  if (parsed.check && parsed.write) throw new Error('Use only one of --check or --write');
  return parsed;
}
