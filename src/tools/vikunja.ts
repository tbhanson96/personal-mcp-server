import { z } from 'zod';
import { marked } from 'marked';
import { ServiceConfig } from '../config.js';
import { VikunjaClient } from '../clients/vikunjaClient.js';
import { HttpClient } from '../http.js';
import { EmptyArgsSchema, parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';

const ListTasksArgsSchema = z.object({
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().max(100).optional(),
  search: z.string().optional(),
});

const RepeatModeSchema = z.enum(['after_due_date', 'monthly', 'from_current_date']);

const CreateTaskArgsSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional(),
  due_date: z.string().datetime({ offset: true }).optional(),
  priority: z.number().int().min(0).max(5).optional(),
  repeat_every_seconds: z.number().int().positive().optional(),
  repeat_mode: RepeatModeSchema.optional(),
}).superRefine(validateRecurrence);

const UpdateTaskArgsSchema = z.object({
  task_id: z.number().int().positive(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  repeat_every_seconds: z.number().int().nonnegative().optional(),
  repeat_mode: RepeatModeSchema.optional(),
}).superRefine(validateRecurrence);

type RecurrenceInput = {
  repeat_every_seconds?: number;
  repeat_mode?: z.infer<typeof RepeatModeSchema>;
};

function validateRecurrence(value: RecurrenceInput, context: z.RefinementCtx) {
  if (value.repeat_mode === 'from_current_date' && !value.repeat_every_seconds) {
    context.addIssue({
      code: 'custom',
      path: ['repeat_every_seconds'],
      message: 'from_current_date recurrence requires a positive repeat_every_seconds value.',
    });
  }
  if (value.repeat_mode === 'after_due_date' && value.repeat_every_seconds === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['repeat_every_seconds'],
      message: 'after_due_date recurrence requires repeat_every_seconds.',
    });
  }
}

const SetTaskDoneArgsSchema = z.object({
  task_id: z.number().int().positive(),
  done: z.boolean().default(true),
});

export function vikunjaTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new VikunjaClient(new HttpClient(config)) : undefined;

  return [
    {
      tool: {
        name: 'vikunja_list_projects',
        title: 'List Vikunja Projects',
        description: 'List visible Vikunja projects.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        parseArgs(EmptyArgsSchema, args);
        return client ? jsonResult(await client.listProjects()) : disabledResult('Vikunja');
      },
    },
    {
      tool: {
        name: 'vikunja_list_tasks',
        title: 'List Vikunja Tasks',
        description: 'List Vikunja tasks, optionally filtered by search text.',
        inputSchema: zodToJsonSchemaObject({
          page: { type: 'number' },
          per_page: { type: 'number', maximum: 100 },
          search: { type: 'string' },
        }),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(ListTasksArgsSchema, args);
        return client ? jsonResult(await client.listTasks(parsed)) : disabledResult('Vikunja');
      },
    },
    {
      tool: {
        name: 'vikunja_create_task',
        title: 'Create Vikunja Task',
        description: 'Create a task in a Vikunja project with optional description, due date, priority, and recurrence. Recurring tasks are always created as new occurrences when completed.',
        inputSchema: zodToJsonSchemaObject({
          project_id: { type: 'number', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', description: 'Markdown task description. The MCP server converts markdown to Vikunja rich-text HTML.' },
          due_date: { type: 'string', format: 'date-time' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
          repeat_every_seconds: {
            type: 'number',
            minimum: 1,
            description: 'Repeat interval in seconds. Required for after_due_date and from_current_date recurrence.',
          },
          repeat_mode: {
            type: 'string',
            enum: ['after_due_date', 'monthly', 'from_current_date'],
            description: 'How recurrence advances. Defaults to after_due_date when repeat_every_seconds is provided.',
          },
        }, ['project_id', 'title']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(CreateTaskArgsSchema, args);
        return client ? jsonResult(await client.createTask(parsed.project_id, compactTask(parsed))) : disabledResult('Vikunja');
      },
    },
    {
      tool: {
        name: 'vikunja_update_task',
        title: 'Update Vikunja Task',
        description: 'Update core Vikunja task fields and recurrence while preserving existing task data. Recurring tasks are always set to create new occurrences when completed.',
        inputSchema: zodToJsonSchemaObject({
          task_id: { type: 'number', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', description: 'Markdown task description. The MCP server converts markdown to Vikunja rich-text HTML.' },
          due_date: { type: ['string', 'null'], format: 'date-time' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
          repeat_every_seconds: {
            type: 'number',
            minimum: 0,
            description: 'Repeat interval in seconds. Use 0 with repeat_mode after_due_date to clear interval-based recurrence.',
          },
          repeat_mode: {
            type: 'string',
            enum: ['after_due_date', 'monthly', 'from_current_date'],
            description: 'How recurrence advances. Defaults to after_due_date when repeat_every_seconds is provided.',
          },
        }, ['task_id']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(UpdateTaskArgsSchema, args);
        if (!client) {
          return disabledResult('Vikunja');
        }

        return jsonResult(await client.updateTask(parsed.task_id, compactTask(parsed)));
      },
    },
    {
      tool: {
        name: 'vikunja_set_task_done',
        title: 'Set Vikunja Task Done',
        description: 'Mark a Vikunja task complete or incomplete while preserving existing task data.',
        inputSchema: zodToJsonSchemaObject({
          task_id: { type: 'number', minimum: 1 },
          done: { type: 'boolean', default: true },
        }, ['task_id']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SetTaskDoneArgsSchema, args);
        if (!client) {
          return disabledResult('Vikunja');
        }

        return jsonResult(await client.updateTask(parsed.task_id, { done: parsed.done }));
      },
    },
  ];
}

function compactTask(task: {
  title?: string;
  description?: string;
  due_date?: string | null;
  priority?: number;
  repeat_every_seconds?: number;
  repeat_mode?: z.infer<typeof RepeatModeSchema>;
}): Record<string, unknown> {
  const repeatMode = task.repeat_mode ?? (task.repeat_every_seconds !== undefined ? 'after_due_date' : undefined);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    title: task.title,
    description: normalizeMarkdownDescription(task.description),
    due_date: task.due_date,
    priority: task.priority,
    repeat_after: task.repeat_every_seconds,
    repeat_mode: repeatMode === undefined ? undefined : repeatModeValue(repeatMode),
    repeat_as_new: true,
  })) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function normalizeMarkdownDescription(description?: string): string | undefined {
  if (description === undefined) {
    return undefined;
  }

  const withNewlines = !description.includes('\n') && description.includes('\\n')
    ? description.replaceAll('\\n', '\n')
    : description;

  const normalized = withNewlines.replace(/\r\n?/g, '\n').trim();
  if (normalized === '' || looksLikeHtml(normalized)) {
    return normalized;
  }

  return marked.parse(normalized, { async: false }) as string;
}

function looksLikeHtml(description: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(description);
}

function repeatModeValue(mode: z.infer<typeof RepeatModeSchema>): number {
  return {
    after_due_date: 0,
    monthly: 1,
    from_current_date: 2,
  }[mode];
}
