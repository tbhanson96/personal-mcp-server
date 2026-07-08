import { z } from 'zod';
import { ServiceConfig } from '../config.js';
import { MealieClient } from '../clients/mealieClient.js';
import { HttpClient } from '../http.js';
import { parseArgs, zodToJsonSchemaObject } from '../schemas/common.js';
import { disabledResult, jsonResult, ToolDefinition } from './types.js';

const SearchRecipesArgsSchema = z.object({
  query: z.string().min(1),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().positive().max(100).default(10),
});

const GetRecipeArgsSchema = z.object({
  slug: z.string().min(1),
});

export function mealieTools(config?: ServiceConfig): ToolDefinition[] {
  const client = config ? new MealieClient(new HttpClient(config)) : undefined;

  return [
    {
      tool: {
        name: 'mealie_search_recipes',
        title: 'Search Mealie Recipes',
        description: 'Search Mealie recipes by query text.',
        inputSchema: zodToJsonSchemaObject({
          query: { type: 'string', minLength: 1 },
          page: { type: 'number', default: 1 },
          per_page: { type: 'number', default: 10, maximum: 100 },
        }, ['query']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(SearchRecipesArgsSchema, args);
        return client ? jsonResult(await client.searchRecipes(parsed.query, parsed.page, parsed.per_page)) : disabledResult('Mealie');
      },
    },
    {
      tool: {
        name: 'mealie_get_recipe',
        title: 'Get Mealie Recipe',
        description: 'Read one Mealie recipe by slug.',
        inputSchema: zodToJsonSchemaObject({
          slug: { type: 'string', minLength: 1 },
        }, ['slug']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(GetRecipeArgsSchema, args);
        return client ? jsonResult(await client.getRecipe(parsed.slug)) : disabledResult('Mealie');
      },
    },
  ];
}
