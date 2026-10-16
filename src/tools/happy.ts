import { z } from 'zod';
import { HappyBridgeConfig } from '../config.js';
import { HappyBridgeClient } from '../clients/happyBridgeClient.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';

const SessionIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const PermissionModeSchema = z.enum(['auto', 'read-only', 'safe-yolo', 'yolo']);
const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

const StartArgsSchema = z.object({
  directory: z.string().min(1).max(4096),
  model: z.string().min(1).max(128).optional(),
  effort: EffortSchema.optional(),
  permission_mode: PermissionModeSchema.default('auto'),
});

const PromptArgsSchema = z.object({
  session_id: SessionIdSchema,
  prompt: z.string().min(1).max(100_000),
  permission_mode: PermissionModeSchema.optional(),
  model: z.string().min(1).max(128).optional(),
  effort: EffortSchema.optional(),
});

const StartAndPromptArgsSchema = StartArgsSchema.extend({
  prompt: z.string().min(1).max(100_000),
});

const StopArgsSchema = z.object({ session_id: SessionIdSchema });

export function happyTools(config?: HappyBridgeConfig): ToolDefinition[] {
  const client = config ? new HappyBridgeClient(config.socketPath) : undefined;
  const call = async (path: string, body: Record<string, unknown> = {}) => {
    if (!client) return disabledResult('Happy bridge');
    return jsonResult(await client.call(path, body));
  };

  return [
    {
      tool: {
        name: 'happy_daemon_status',
        title: 'Get Happy Daemon Status',
        description: 'Check the host Happy daemon version and connection state.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return call('/status');
      },
      metadata: {
        category: 'happy',
        tags: ['happy', 'daemon', 'status', 'read'],
        relatedTools: ['happy_list_sessions'],
        changesState: false,
      },
    },
    {
      tool: {
        name: 'happy_list_sessions',
        title: 'List Happy Sessions',
        description: 'List active Happy sessions tracked by the daemon on this host.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return call('/sessions/list');
      },
      metadata: {
        category: 'happy',
        tags: ['happy', 'sessions', 'list', 'read'],
        relatedTools: ['happy_send_prompt', 'happy_stop_session'],
        changesState: false,
      },
    },
    {
      tool: {
        name: 'happy_start_codex_session',
        title: 'Start Happy Codex Session',
        description: 'Start a daemon-owned Happy Codex session in an allowlisted existing directory. The session appears in the Happy app. Defaults to auto permissions.',
        inputSchema: zodToJsonSchemaObject({
          directory: { type: 'string', minLength: 1, description: 'Existing working directory under an allowlisted root.' },
          model: { type: 'string', minLength: 1 },
          effort: { type: 'string', enum: EffortSchema.options },
          permission_mode: { type: 'string', enum: PermissionModeSchema.options, default: 'auto' },
        }, ['directory']),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      execute: async (args) => call('/sessions/start', parseArgs(StartArgsSchema, args)),
      metadata: {
        category: 'happy',
        tags: ['happy', 'codex', 'session', 'start'],
        relatedTools: ['happy_send_prompt', 'happy_start_and_prompt'],
        workflowNotes: ['Prefer happy_start_and_prompt when an initial task is already known. Use auto permissions unless the user explicitly requests another mode.'],
        changesState: true,
      },
    },
    {
      tool: {
        name: 'happy_send_prompt',
        title: 'Send Prompt to Happy Session',
        description: 'Send an encrypted user prompt to an active locally tracked Happy session. The prompt and response appear in the Happy app.',
        inputSchema: zodToJsonSchemaObject({
          session_id: { type: 'string', minLength: 1 },
          prompt: { type: 'string', minLength: 1, maxLength: 100_000 },
          permission_mode: { type: 'string', enum: PermissionModeSchema.options },
          model: { type: 'string', minLength: 1 },
          effort: { type: 'string', enum: EffortSchema.options },
        }, ['session_id', 'prompt']),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      execute: async (args) => call('/sessions/prompt', parseArgs(PromptArgsSchema, args)),
      metadata: {
        category: 'happy',
        tags: ['happy', 'session', 'prompt', 'message'],
        relatedTools: ['happy_list_sessions', 'happy_stop_session'],
        workflowNotes: ['List sessions first when the target session ID is not already known.'],
        changesState: true,
      },
    },
    {
      tool: {
        name: 'happy_start_and_prompt',
        title: 'Start and Prompt Happy Codex Session',
        description: 'Start a daemon-owned Happy Codex session and immediately deliver its first encrypted prompt. The complete conversation appears in the Happy app.',
        inputSchema: zodToJsonSchemaObject({
          directory: { type: 'string', minLength: 1, description: 'Existing working directory under an allowlisted root.' },
          prompt: { type: 'string', minLength: 1, maxLength: 100_000 },
          model: { type: 'string', minLength: 1 },
          effort: { type: 'string', enum: EffortSchema.options },
          permission_mode: { type: 'string', enum: PermissionModeSchema.options, default: 'auto' },
        }, ['directory', 'prompt']),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      execute: async (args) => call('/sessions/start-and-prompt', parseArgs(StartAndPromptArgsSchema, args)),
      metadata: {
        category: 'happy',
        tags: ['happy', 'codex', 'session', 'start', 'prompt'],
        relatedTools: ['happy_list_sessions', 'happy_stop_session'],
        workflowNotes: ['Use auto permissions unless the user explicitly requests another mode. The tool returns after Happy accepts the prompt; follow progress in the Happy app.'],
        changesState: true,
      },
    },
    {
      tool: {
        name: 'happy_stop_session',
        title: 'Stop Happy Session',
        description: 'Stop one active Happy session tracked by the local daemon.',
        inputSchema: zodToJsonSchemaObject({ session_id: { type: 'string', minLength: 1 } }, ['session_id']),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      execute: async (args) => call('/sessions/stop', parseArgs(StopArgsSchema, args)),
      metadata: {
        category: 'happy',
        tags: ['happy', 'session', 'stop'],
        relatedTools: ['happy_list_sessions'],
        changesState: true,
      },
    },
  ];
}
