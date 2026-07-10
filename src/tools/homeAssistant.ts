import { ServiceConfig } from '../config.js';
import { HttpClient } from '../http.js';
import { HomeAssistantClient } from '../clients/homeAssistantClient.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';
import { z } from 'zod';

const StateArgsSchema = z.object({
  entity_id: z.string().min(1),
});

const ControlEntityArgsSchema = z.object({
  entity_id: z.string().regex(/^(light|switch|input_boolean|automation|script|scene)\.[a-zA-Z0-9_]+$/, 'Expected a supported Home Assistant entity_id'),
  action: z.enum(['turn_on', 'turn_off', 'toggle']),
}).superRefine((value, context) => {
  if (value.entity_id.startsWith('scene.') && value.action !== 'turn_on') {
    context.addIssue({
      code: 'custom',
      path: ['action'],
      message: 'Scenes only support turn_on.',
    });
  }
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
    {
      tool: {
        name: 'home_assistant_control_entity',
        title: 'Control Home Assistant Entity',
        description: 'Turn on, turn off, or toggle a supported Home Assistant entity such as a light, switch, automation, script, scene, or input boolean.',
        inputSchema: zodToJsonSchemaObject({
          entity_id: {
            type: 'string',
            minLength: 1,
            description: 'A supported entity_id, for example light.living_room_2 or script.movie_time.',
          },
          action: { type: 'string', enum: ['turn_on', 'turn_off', 'toggle'] },
        }, ['entity_id', 'action']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ControlEntityArgsSchema, args);
        return client ? jsonResult(await client.controlEntity(parsed.entity_id, parsed.action)) : disabledResult('Home Assistant');
      },
    },
  ];
}
