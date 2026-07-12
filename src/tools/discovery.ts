import { z } from 'zod';
import { parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { jsonResult, ToolDefinition, ToolMetadata } from './types.js';

const SERVER_VERSION = '0.1.0';

const DescribeToolArgsSchema = z.object({
  tool_name: z.string().min(1),
});

const examples = [
  {
    userRequest: 'Show my open tasks.',
    preferredTool: 'vikunja_list_tasks',
    arguments: { per_page: 100 },
  },
  {
    userRequest: 'Create a recurring task to do laundry every 10 days.',
    preferredTool: 'vikunja_create_task',
    arguments: {
      project_id: '<project id from vikunja_list_projects>',
      title: 'Laundry',
      repeat_every_seconds: 864000,
      repeat_mode: 'from_current_date',
    },
  },
  {
    userRequest: 'Find dinner recipes with chicken.',
    preferredTool: 'mealie_search_recipes',
    arguments: { query: 'chicken dinner' },
  },
  {
    userRequest: 'Import this recipe URL into Mealie.',
    preferredTool: 'mealie_create_recipe_from_url',
    arguments: { url: 'https://example.com/recipe' },
  },
  {
    userRequest: 'Turn on the living room light.',
    preferredTool: 'home_assistant_control_entity',
    arguments: { entity_id: 'light.living_room_2', action: 'turn_on' },
  },
  {
    userRequest: 'What was my highest heart rate yesterday?',
    preferredTool: 'homeserver_get_health_statistics',
    arguments: {
      metric: 'heart_rate',
      start: '<yesterday start ISO datetime>',
      end: '<today start ISO datetime>',
      aggregation: 'daily',
    },
  },
  {
    userRequest: 'Show my heart rate samples yesterday.',
    preferredTool: 'homeserver_query_health_metric',
    arguments: {
      metric: 'heart_rate',
      start: '<yesterday start ISO datetime>',
      end: '<today start ISO datetime>',
    },
  },
  {
    userRequest: 'How long did I sleep last night?',
    preferredTool: 'homeserver_get_sleep_data',
    arguments: {
      start: '<night start ISO datetime>',
      end: '<morning end ISO datetime>',
    },
  },
];

const metadataByToolName: Record<string, ToolMetadata> = {
  home_assistant_get_config: {
    category: 'home_assistant',
    tags: ['home_assistant', 'configuration', 'diagnostics', 'read'],
    examples: ['Check Home Assistant configuration.'],
    relatedTools: ['home_assistant_get_states', 'home_assistant_get_state'],
    changesState: false,
  },
  home_assistant_get_states: {
    category: 'home_assistant',
    tags: ['home_assistant', 'entities', 'state', 'read'],
    examples: ['List current Home Assistant entities before choosing one to control.'],
    relatedTools: ['home_assistant_get_state', 'home_assistant_control_entity'],
    changesState: false,
  },
  home_assistant_get_state: {
    category: 'home_assistant',
    tags: ['home_assistant', 'entity', 'state', 'read'],
    examples: ['Check whether light.living_room_2 is on.'],
    relatedTools: ['home_assistant_get_states', 'home_assistant_control_entity'],
    changesState: false,
  },
  home_assistant_control_entity: {
    category: 'home_assistant',
    tags: ['home_assistant', 'entity', 'device_control', 'lighting', 'automation'],
    examples: ['Turn on light.living_room_2.', 'Toggle an input_boolean helper.'],
    relatedTools: ['home_assistant_get_states', 'home_assistant_get_state'],
    workflowNotes: ['Use get_states first if the user names a device but not an entity_id. Scenes only support turn_on.'],
    changesState: true,
  },
  homeserver_list_files: {
    category: 'files',
    tags: ['homeserver', 'files', 'folders', 'browse', 'read'],
    examples: ['Show files in Downloads.', 'Browse /media/documents.'],
    changesState: false,
  },
  homeserver_list_ebooks: {
    category: 'ebooks',
    tags: ['homeserver', 'ebooks', 'newspapers', 'library', 'read'],
    examples: ['List recent ebooks.', 'Show newspapers in the library.'],
    relatedTools: ['homeserver_search_ebooks'],
    changesState: false,
  },
  homeserver_search_ebooks: {
    category: 'ebooks',
    tags: ['homeserver', 'ebooks', 'search', 'library', 'read'],
    examples: ['Search ebooks for Dune.', 'Find the Dedica espresso manual.'],
    relatedTools: ['homeserver_list_ebooks'],
    changesState: false,
  },
  homeserver_get_health_catalog: {
    category: 'health',
    tags: ['homeserver', 'health', 'monitoring', 'metrics', 'read'],
    examples: ['Show available health metrics.', 'Find the exact metric name for resting heart rate.'],
    relatedTools: [
      'homeserver_query_health_metric',
      'homeserver_get_health_statistics',
      'homeserver_get_health_daily_summary',
      'homeserver_get_sleep_data',
    ],
    workflowNotes: ['Use this first when the user asks about a health metric by a human name and the exact metric key is unknown.'],
    changesState: false,
  },
  homeserver_query_health_metric: {
    category: 'health',
    tags: ['homeserver', 'health', 'apple_health', 'timeseries', 'metrics', 'heart_rate', 'read'],
    examples: ['Show heart_rate samples from yesterday.', 'Return raw resting_heart_rate data this week.'],
    relatedTools: ['homeserver_get_health_catalog', 'homeserver_get_health_statistics'],
    workflowNotes: ['Use for raw samples or graphable time-series data. Use ISO datetime boundaries.'],
    changesState: false,
  },
  homeserver_get_health_statistics: {
    category: 'health',
    tags: ['homeserver', 'health', 'apple_health', 'statistics', 'aggregation', 'heart_rate', 'read'],
    examples: ['What was my highest heart rate yesterday?', 'Average resting heart rate this week.'],
    relatedTools: ['homeserver_get_health_catalog', 'homeserver_query_health_metric', 'homeserver_get_health_daily_summary'],
    workflowNotes: ['Use maxValue for highest values, averageValue for averages, minValue for lows, and totalValue for cumulative metrics like calories.'],
    changesState: false,
  },
  homeserver_get_health_daily_summary: {
    category: 'health',
    tags: ['homeserver', 'health', 'apple_health', 'daily_summary', 'statistics', 'read'],
    examples: ['Summarize my health metrics yesterday.', 'Calories burned today.'],
    relatedTools: ['homeserver_get_health_catalog', 'homeserver_get_health_statistics', 'homeserver_get_sleep_data'],
    workflowNotes: ['If metrics are omitted, this can return a large summary across every catalog metric. Prefer specifying metrics for focused answers.'],
    changesState: false,
  },
  homeserver_get_sleep_data: {
    category: 'health',
    tags: ['homeserver', 'health', 'apple_health', 'sleep', 'duration', 'read'],
    examples: ['Show sleep records from last night.', 'How long did I sleep yesterday?'],
    relatedTools: ['homeserver_get_health_daily_summary'],
    workflowNotes: ['Use sleep record startDate and endDate to compute durations by sleep stage/value.'],
    changesState: false,
  },
  mealie_search_recipes: {
    category: 'mealie',
    tags: ['mealie', 'recipes', 'search', 'food', 'read'],
    examples: ['Search recipes for pasta.', 'Find chicken dinner recipes.'],
    relatedTools: ['mealie_get_recipe', 'mealie_create_recipe_from_url'],
    changesState: false,
  },
  mealie_get_recipe: {
    category: 'mealie',
    tags: ['mealie', 'recipes', 'details', 'food', 'read'],
    examples: ['Get the full recipe for a slug returned by search.'],
    relatedTools: ['mealie_search_recipes'],
    changesState: false,
  },
  mealie_create_recipe_from_url: {
    category: 'mealie',
    tags: ['mealie', 'recipes', 'import', 'url', 'food'],
    examples: ['Import a recipe from a URL into Mealie.'],
    relatedTools: ['mealie_search_recipes', 'mealie_get_recipe'],
    changesState: true,
  },
  mealie_list_shopping_lists: {
    category: 'mealie',
    tags: ['mealie', 'shopping', 'groceries', 'lists', 'read'],
    examples: ['List shopping lists before adding a grocery item.'],
    relatedTools: ['mealie_add_shopping_item'],
    changesState: false,
  },
  mealie_add_shopping_item: {
    category: 'mealie',
    tags: ['mealie', 'shopping', 'groceries', 'add'],
    examples: ['Add milk to the grocery list.'],
    relatedTools: ['mealie_list_shopping_lists'],
    workflowNotes: ['Call mealie_list_shopping_lists first if the user names a list instead of providing shopping_list_id.'],
    changesState: true,
  },
  vikunja_list_projects: {
    category: 'vikunja',
    tags: ['vikunja', 'projects', 'tasks', 'read'],
    examples: ['List projects before creating a task.'],
    relatedTools: ['vikunja_create_task', 'vikunja_list_tasks'],
    changesState: false,
  },
  vikunja_list_tasks: {
    category: 'vikunja',
    tags: ['vikunja', 'tasks', 'todo', 'search', 'read'],
    examples: ['Show open tasks.', 'Search tasks for laundry.'],
    relatedTools: ['vikunja_create_task', 'vikunja_update_task', 'vikunja_set_task_done'],
    changesState: false,
  },
  vikunja_create_task: {
    category: 'vikunja',
    tags: ['vikunja', 'tasks', 'todo', 'create', 'recurring'],
    examples: ['Create a task due tomorrow.', 'Create a recurring house meeting task every week.'],
    relatedTools: ['vikunja_list_projects', 'vikunja_list_tasks'],
    workflowNotes: ['Use vikunja_list_projects first when the user names a project. Recurring tasks always set repeat_as_new server-side.'],
    changesState: true,
  },
  vikunja_update_task: {
    category: 'vikunja',
    tags: ['vikunja', 'tasks', 'todo', 'update', 'recurring'],
    examples: ['Move a task due date.', 'Add recurrence to an existing task.'],
    relatedTools: ['vikunja_list_tasks', 'vikunja_set_task_done'],
    workflowNotes: ['Use vikunja_list_tasks first when the user names a task instead of providing task_id. Recurring tasks always set repeat_as_new server-side.'],
    changesState: true,
  },
  vikunja_set_task_done: {
    category: 'vikunja',
    tags: ['vikunja', 'tasks', 'todo', 'complete'],
    examples: ['Mark a task complete.', 'Reopen a completed task.'],
    relatedTools: ['vikunja_list_tasks', 'vikunja_update_task'],
    workflowNotes: ['Use vikunja_list_tasks first when the user names a task instead of providing task_id.'],
    changesState: true,
  },
};

export function discoveryTools(serviceTools: ToolDefinition[]): ToolDefinition[] {
  const discoveryDefinitions: ToolDefinition[] = [
    {
      tool: {
        name: 'personal_mcp_get_capabilities',
        title: 'Get Personal MCP Capabilities',
        description: 'Discover this MCP server version, categories, workflows, and available tools with semantic metadata.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      metadata: {
        category: 'discovery',
        tags: ['discovery', 'capabilities', 'metadata', 'tools'],
        examples: ['Discover what this MCP server can do before choosing a tool.'],
        relatedTools: ['personal_mcp_describe_tool', 'personal_mcp_get_usage_guide', 'personal_mcp_get_examples'],
        changesState: false,
      },
      execute: async () => jsonResult({
        server: {
          name: 'personal-mcp-server',
          version: SERVER_VERSION,
          purpose: 'Personal MCP server for Home Assistant, homeserver files/media/ebooks/health, Mealie, and Vikunja.',
        },
        conventions: usageGuide(),
        categories: categoriesFor(allTools()),
        tools: allTools().map((definition) => summarizeTool(definition)),
        examples,
      }),
    },
    {
      tool: {
        name: 'personal_mcp_describe_tool',
        title: 'Describe Personal MCP Tool',
        description: 'Return detailed metadata, schema, examples, caveats, and related tools for one MCP tool.',
        inputSchema: zodToJsonSchemaObject({
          tool_name: { type: 'string', minLength: 1 },
        }, ['tool_name']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      metadata: {
        category: 'discovery',
        tags: ['discovery', 'metadata', 'tool_description', 'schema'],
        examples: ['Describe vikunja_create_task before creating a task.'],
        relatedTools: ['personal_mcp_get_capabilities'],
        changesState: false,
      },
      execute: async (args) => {
        const parsed = parseArgs(DescribeToolArgsSchema, args);
        const definition = allTools().find((candidate) => candidate.tool.name === parsed.tool_name);
        if (!definition) {
          return jsonResult({
            error: `Unknown tool: ${parsed.tool_name}`,
            availableTools: allTools().map((tool) => tool.tool.name).sort(),
          });
        }

        return jsonResult(describeTool(definition));
      },
    },
    {
      tool: {
        name: 'personal_mcp_get_usage_guide',
        title: 'Get Personal MCP Usage Guide',
        description: 'Return high-level usage conventions and preferred workflows for this personal MCP server.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      metadata: {
        category: 'discovery',
        tags: ['discovery', 'usage', 'workflows', 'guidance'],
        examples: ['Get server guidance before using an unfamiliar capability.'],
        relatedTools: ['personal_mcp_get_capabilities', 'personal_mcp_get_examples'],
        changesState: false,
      },
      execute: async () => jsonResult(usageGuide()),
    },
    {
      tool: {
        name: 'personal_mcp_get_examples',
        title: 'Get Personal MCP Examples',
        description: 'Return representative user requests mapped to preferred MCP tools and example arguments.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      metadata: {
        category: 'discovery',
        tags: ['discovery', 'examples', 'tool_selection', 'workflows'],
        examples: ['Review examples before deciding which personal MCP tool to call.'],
        relatedTools: ['personal_mcp_get_capabilities', 'personal_mcp_get_usage_guide'],
        changesState: false,
      },
      execute: async () => jsonResult({ examples }),
    },
  ];

  function allTools() {
    return [...discoveryDefinitions, ...serviceTools];
  }

  return discoveryDefinitions;
}

function summarizeTool(definition: ToolDefinition) {
  const metadata = metadataFor(definition);
  return {
    name: definition.tool.name,
    title: definition.tool.title,
    description: definition.tool.description,
    category: metadata.category,
    tags: metadata.tags,
    changesState: metadata.changesState ?? false,
    annotations: definition.tool.annotations,
    examples: metadata.examples ?? [],
    relatedTools: metadata.relatedTools ?? [],
  };
}

function describeTool(definition: ToolDefinition) {
  const metadata = metadataFor(definition);
  return {
    ...summarizeTool(definition),
    inputSchema: definition.tool.inputSchema,
    workflowNotes: metadata.workflowNotes ?? [],
  };
}

function metadataFor(definition: ToolDefinition): ToolMetadata {
  return {
    ...fallbackMetadata(definition),
    ...metadataByToolName[definition.tool.name],
    ...definition.metadata,
  };
}

function fallbackMetadata(definition: ToolDefinition): ToolMetadata {
  const [prefix] = definition.tool.name.split('_');
  const changesState = definition.tool.name.includes('_add_')
    || definition.tool.name.includes('_create_')
    || definition.tool.name.includes('_update_')
    || definition.tool.name.includes('_control_')
    || definition.tool.name.includes('_set_');
  return {
    category: prefix || 'general',
    tags: definition.tool.name.split('_'),
    changesState,
  };
}

function categoriesFor(definitions: ToolDefinition[]) {
  const categories = new Map<string, { toolCount: number; tags: Set<string> }>();
  for (const definition of definitions) {
    const metadata = metadataFor(definition);
    const category = categories.get(metadata.category) ?? { toolCount: 0, tags: new Set<string>() };
    category.toolCount += 1;
    for (const tag of metadata.tags) {
      category.tags.add(tag);
    }
    categories.set(metadata.category, category);
  }

  return [...categories.entries()].map(([name, value]) => ({
    name,
    toolCount: value.toolCount,
    tags: [...value.tags].sort(),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function usageGuide() {
  return {
    discovery: [
      'Use personal_mcp_get_capabilities when you need to discover what this server can do.',
      'Use personal_mcp_describe_tool before using an unfamiliar or ambiguous tool.',
      'Prefer published descriptions, tags, relatedTools, workflowNotes, and inputSchema over assumptions from memory.',
    ],
    workflows: [
      'For named Vikunja projects or tasks, list projects or tasks first to resolve ids before create/update/complete operations.',
      'For Mealie shopping items, list shopping lists first when the user names a list instead of providing a shopping_list_id.',
      'For Home Assistant device names, list states first to identify the correct entity_id.',
      'For Apple Health questions, use the health catalog to resolve metric names, statistics for aggregate questions, raw metric query for graphable samples, and sleep data for sleep durations.',
    ],
    safety: [
      'Some tools change state even though they are marked readOnlyHint true for ChatGPT discovery compatibility.',
      'Use semantic intent and tool descriptions to distinguish read operations from state-changing operations.',
      'Do not ask the user for hidden tokens.',
    ],
  };
}
