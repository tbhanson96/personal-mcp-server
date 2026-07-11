import { describe, expect, it } from 'vitest';
import { createToolDefinitions, securityScopesForTool } from '../src/server.js';
import { AppConfig } from '../src/config.js';

const baseConfig: AppConfig = {
  port: 3000,
  bindAddress: '127.0.0.1',
  mcpApiKey: 'secret',
};

describe('createToolDefinitions', () => {
  it('registers the expected initial tools', () => {
    const names = createToolDefinitions(baseConfig).map((definition) => definition.tool.name);

    expect(names).toEqual([
      'personal_mcp_get_capabilities',
      'personal_mcp_describe_tool',
      'personal_mcp_get_usage_guide',
      'personal_mcp_get_examples',
      'home_assistant_get_config',
      'home_assistant_get_states',
      'home_assistant_get_state',
      'home_assistant_control_entity',
      'homeserver_list_files',
      'homeserver_list_ebooks',
      'homeserver_search_ebooks',
      'homeserver_get_health_catalog',
      'mealie_search_recipes',
      'mealie_get_recipe',
      'mealie_create_recipe_from_url',
      'mealie_list_shopping_lists',
      'mealie_add_shopping_item',
      'vikunja_list_projects',
      'vikunja_list_tasks',
      'vikunja_create_task',
      'vikunja_update_task',
      'vikunja_set_task_done',
    ]);
  });

  it('keeps tools registered when services are not configured', async () => {
    const tool = createToolDefinitions(baseConfig).find((definition) => definition.tool.name === 'vikunja_list_projects');

    const result = await tool?.execute({});

    expect(result?.content[0]).toMatchObject({
      type: 'text',
    });
    const content = result?.content[0];
    expect(content?.type).toBe('text');
    if (content?.type === 'text') {
      expect(content.text).toContain('Vikunja is not configured');
    }
  });

  it('exposes recurring task fields without exposing repeat-as-new toggle', () => {
    const tool = createToolDefinitions(baseConfig).find((definition) => definition.tool.name === 'vikunja_create_task');
    const properties = tool?.tool.inputSchema.properties || {};

    expect(properties).toHaveProperty('repeat_every_seconds');
    expect(properties).toHaveProperty('repeat_mode');
    expect(properties).not.toHaveProperty('repeat_as_new');
  });

  it('advertises read scope for every tool', () => {
    const tools = createToolDefinitions(baseConfig);
    const listTasks = tools.find((definition) => definition.tool.name === 'vikunja_list_tasks');
    const createTask = tools.find((definition) => definition.tool.name === 'vikunja_create_task');

    expect(listTasks && securityScopesForTool(listTasks)).toEqual(['mcp:read']);
    expect(createTask && securityScopesForTool(createTask)).toEqual(['mcp:read']);
  });

  it('exposes self-describing capabilities for all registered tools', async () => {
    const tools = createToolDefinitions(baseConfig);
    const capabilitiesTool = tools.find((definition) => definition.tool.name === 'personal_mcp_get_capabilities');

    const result = await capabilitiesTool?.execute({});
    const content = result?.content[0];

    expect(content?.type).toBe('text');
    if (content?.type === 'text') {
      const payload = JSON.parse(content.text);
      expect(payload.tools).toHaveLength(tools.length);
      expect(payload.tools.map((tool: { name: string }) => tool.name)).toContain('vikunja_create_task');
      expect(payload.tools.map((tool: { name: string }) => tool.name)).toContain('personal_mcp_describe_tool');
    }
  });

  it('describes one tool with schema, examples, and workflow notes', async () => {
    const describeTool = createToolDefinitions(baseConfig).find((definition) => definition.tool.name === 'personal_mcp_describe_tool');

    const result = await describeTool?.execute({ tool_name: 'vikunja_create_task' });
    const content = result?.content[0];

    expect(content?.type).toBe('text');
    if (content?.type === 'text') {
      const payload = JSON.parse(content.text);
      expect(payload.name).toBe('vikunja_create_task');
      expect(payload.category).toBe('vikunja');
      expect(payload.tags).toContain('recurring');
      expect(payload.inputSchema.properties).toHaveProperty('repeat_every_seconds');
      expect(payload.workflowNotes.join(' ')).toContain('repeat_as_new');
    }
  });
});
