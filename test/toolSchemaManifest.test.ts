import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../src/config.js';
import { createToolDefinitions } from '../src/server.js';
import { createToolSchemaManifest, serializeToolSchemaManifest } from '../src/toolSchemaManifest.js';

const config: AppConfig = {
  port: 3000,
  bindAddress: '127.0.0.1',
  mcpApiKey: 'manifest-test-placeholder',
};

describe('tool schema manifest', () => {
  it('matches the checked-in deployment comparison snapshot', async () => {
    const checkedIn = await readFile(new URL('../config/tool-schema-manifest.json', import.meta.url), 'utf8');
    expect(serializeToolSchemaManifest(createToolDefinitions(config))).toBe(checkedIn);
  });

  it('contains complete advertised OAuth metadata without execution functions', () => {
    const manifest = createToolSchemaManifest(createToolDefinitions(config)) as { tools: Array<Record<string, unknown>> };
    const thermostat = manifest.tools.find((tool) => tool.name === 'home_assistant_set_temperature');
    const callService = manifest.tools.find((tool) => tool.name === 'home_assistant_call_service');
    expect(thermostat?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp:control'] }]);
    expect(callService?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp:control'] }]);
    expect(callService?.inputSchema).toMatchObject({
      required: ['domain', 'service', 'entity_id'],
      additionalProperties: false,
    });
    expect(thermostat).not.toHaveProperty('execute');
    expect(callService).not.toHaveProperty('execute');
  });
});
