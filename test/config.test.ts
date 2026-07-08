import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('loads required and optional service config', () => {
    const config = loadConfig({
      PERSONAL_MCP_API_KEY: 'secret',
      PORT: '3333',
      HOME_ASSISTANT_URL: 'http://ha.local/',
      HOME_ASSISTANT_TOKEN: 'ha-token',
    });

    expect(config.port).toBe(3333);
    expect(config.mcpApiKey).toBe('secret');
    expect(config.homeAssistant).toEqual({
      baseUrl: 'http://ha.local',
      token: 'ha-token',
    });
  });

  it('requires MCP API key', () => {
    expect(() => loadConfig({})).toThrow(/PERSONAL_MCP_API_KEY/);
  });
});
