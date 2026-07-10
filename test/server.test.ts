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
      'home_assistant_get_config',
      'home_assistant_get_states',
      'home_assistant_get_state',
      'home_assistant_control_entity',
      'homeserver_list_files',
      'homeserver_list_ebooks',
      'homeserver_search_ebooks',
      'homeserver_get_health_catalog',
      'homeserver_search_personal_media_downloads',
      'homeserver_add_personal_media_download',
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

  it('uses write OAuth scope for write tools and read scope for read-only tools', () => {
    const tools = createToolDefinitions(baseConfig);
    const listTasks = tools.find((definition) => definition.tool.name === 'vikunja_list_tasks');
    const createTask = tools.find((definition) => definition.tool.name === 'vikunja_create_task');

    expect(listTasks && securityScopesForTool(listTasks)).toEqual(['mcp:read']);
    expect(createTask && securityScopesForTool(createTask)).toEqual(['mcp:write']);
  });
});
