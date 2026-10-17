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

const GetMessagesArgsSchema = z.object({
  session_id: SessionIdSchema,
  after_seq: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  wait_seconds: z.number().int().min(0).max(20).default(0),
  detail: z.enum(['summary', 'full']).default('summary'),
  max_content_chars: z.number().int().min(1).max(100_000).default(20_000),
});

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
        description: 'Check the host Happy daemon version, connection state, and allowed host working-directory roots. Call this before starting a session when the host path is uncertain.',
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
        relatedTools: ['happy_list_sessions', 'happy_start_codex_session', 'happy_start_and_prompt'],
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
        description: 'Start a daemon-owned Happy Codex session in an existing absolute host directory under a root reported by happy_daemon_status.allowed_roots. Do not reuse /Repo-style paths from homeserver file tools; those may be in a different filesystem namespace. The session appears in the Happy app. Defaults to auto permissions.',
        inputSchema: zodToJsonSchemaObject({
          directory: { type: 'string', minLength: 1, description: 'Existing absolute host path under happy_daemon_status.allowed_roots, for example /home/tim/Repo/project. This is not a homeserver API path such as /Repo/project.' },
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
        workflowNotes: ['Prefer happy_start_and_prompt when an initial task is already known. Call happy_daemon_status when the absolute host path is uncertain. Paths returned by homeserver file tools may not be valid host paths. Use auto permissions unless the user explicitly requests another mode.'],
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
        name: 'happy_get_session_messages',
        title: 'Get Happy Session Messages',
        description: 'Read decrypted messages from a locally known Happy session using a sequence cursor. Supports bounded waiting for Codex output and summary or full telemetry.',
        inputSchema: zodToJsonSchemaObject({
          session_id: { type: 'string', minLength: 1 },
          after_seq: { type: 'integer', minimum: 0, default: 0, description: 'Exclusive message sequence cursor from a previous next_after_seq value.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          wait_seconds: { type: 'integer', minimum: 0, maximum: 20, default: 0, description: 'Wait up to this many seconds for agent output; zero returns immediately.' },
          detail: { type: 'string', enum: ['summary', 'full'], default: 'summary', description: 'Summary returns conversational and status messages; full also includes reasoning and tool telemetry.' },
          max_content_chars: { type: 'integer', minimum: 1, maximum: 100_000, default: 20_000, description: 'Maximum text or serialized content characters returned per message.' },
        }, ['session_id']),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      execute: async (args) => call('/sessions/messages', parseArgs(GetMessagesArgsSchema, args)),
      metadata: {
        category: 'happy',
        tags: ['happy', 'session', 'messages', 'codex', 'read'],
        relatedTools: ['happy_send_prompt', 'happy_start_and_prompt', 'happy_stop_session'],
        workflowNotes: ['Pass next_after_seq into after_seq on the next call. Use wait_seconds for bounded polling after sending a prompt. Use full detail only when tool or reasoning telemetry is needed.'],
        changesState: false,
      },
    },
    {
      tool: {
        name: 'happy_start_and_prompt',
        title: 'Start and Prompt Happy Codex Session',
        description: 'Start a daemon-owned Happy Codex session in an existing absolute host directory under happy_daemon_status.allowed_roots and immediately deliver its first encrypted prompt. Do not reuse /Repo-style homeserver paths. The complete conversation appears in the Happy app.',
        inputSchema: zodToJsonSchemaObject({
          directory: { type: 'string', minLength: 1, description: 'Existing absolute host path under happy_daemon_status.allowed_roots, for example /home/tim/Repo/project. This is not a homeserver API path such as /Repo/project.' },
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
        workflowNotes: ['Call happy_daemon_status when the absolute host path is uncertain; homeserver file paths may use a different namespace. Use auto permissions unless the user explicitly requests another mode. The tool returns after Happy accepts the prompt; use happy_get_session_messages to follow progress.'],
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
