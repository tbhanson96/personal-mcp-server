import { ServiceConfig } from '../config.js';
import { HttpClient } from '../http.js';
import { HomeAssistantClient } from '../clients/homeAssistantClient.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';
import { z } from 'zod';

const StateArgsSchema = z.object({
  entity_id: z.string().min(1),
});

export function homeAssistantTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new HomeAssistantClient(new HttpClient(config)) : undefined;

  return [
    {
      tool: {
        name: 'home_assistant_get_config',
        title: 'Get Home Assistant Config',
        description: 'Read Home Assistant instance configuration.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.getConfig()) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_get_states',
        title: 'Get Home Assistant States',
        description: 'List current Home Assistant entity states.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.getStates()) : disabledResult('Home Assistant');
      },
    },
    {
      tool: {
        name: 'home_assistant_get_state',
        title: 'Get Home Assistant Entity State',
        description: 'Read one Home Assistant entity state by entity_id.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: { type: 'string', minLength: 1 },
        }, ['entity_id']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(StateArgsSchema, args);
        return client ? jsonResult(await client.getState(parsed.entity_id)) : disabledResult('Home Assistant');
      },
    },
  ];
}
