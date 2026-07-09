import { z } from 'zod';
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

const CreateTaskArgsSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional(),
  due_date: z.string().datetime({ offset: true }).optional(),
  priority: z.number().int().min(0).max(5).optional(),
});

const UpdateTaskArgsSchema = z.object({
  task_id: z.number().int().positive(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.number().int().min(0).max(5).optional(),
});

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
        description: 'Create a task in a Vikunja project with optional description, due date, and priority.',
        inputSchema: zodToJsonSchemaObject({
          project_id: { type: 'number', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          due_date: { type: 'string', format: 'date-time' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
        }, ['project_id', 'title']),
        annotations: { readOnlyHint: false, destructiveHint: false },
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
        description: 'Update core Vikunja task fields while preserving existing task data.',
        inputSchema: zodToJsonSchemaObject({
          task_id: { type: 'number', minimum: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          due_date: { type: ['string', 'null'], format: 'date-time' },
          priority: { type: 'number', minimum: 0, maximum: 5 },
        }, ['task_id']),
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(UpdateTaskArgsSchema, args);
        if (!client) {
          return disabledResult('Vikunja');
        }

        const existingTask = await client.getTask(parsed.task_id);
        return jsonResult(await client.updateTask(parsed.task_id, {
          ...existingTask,
          ...compactTask(parsed),
        }));
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
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SetTaskDoneArgsSchema, args);
        if (!client) {
          return disabledResult('Vikunja');
        }

        const existingTask = await client.getTask(parsed.task_id);
        return jsonResult(await client.updateTask(parsed.task_id, {
          ...existingTask,
          done: parsed.done,
        }));
      },
    },
  ];
}

function compactTask(task: {
  title?: string;
  description?: string;
  due_date?: string | null;
  priority?: number;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    priority: task.priority,
  })) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
