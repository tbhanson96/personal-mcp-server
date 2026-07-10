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

const CreateRecipeFromUrlArgsSchema = z.object({
  url: z.string().url(),
  include_tags: z.boolean().default(true),
  include_categories: z.boolean().default(true),
});

const AddShoppingItemArgsSchema = z.object({
  shopping_list_id: z.string().uuid(),
  item: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1).optional(),
  note: z.string().optional(),
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
    {
      tool: {
        name: 'mealie_create_recipe_from_url',
        title: 'Create Mealie Recipe From URL',
        description: 'Import a recipe into Mealie by scraping a recipe URL.',
        inputSchema: zodToJsonSchemaObject({
          url: { type: 'string', format: 'uri' },
          include_tags: { type: 'boolean', default: true },
          include_categories: { type: 'boolean', default: true },
        }, ['url']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(CreateRecipeFromUrlArgsSchema, args);
        return client ? jsonResult(await client.createRecipeFromUrl(parsed.url, parsed.include_tags, parsed.include_categories)) : disabledResult('Mealie');
      },
    },
    {
      tool: {
        name: 'mealie_list_shopping_lists',
        title: 'List Mealie Shopping Lists',
        description: 'List Mealie shopping lists so write operations can target the correct list.',
        inputSchema: zodToJsonSchemaObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async () => {
        return client ? jsonResult(await client.listShoppingLists()) : disabledResult('Mealie');
      },
    },
    {
      tool: {
        name: 'mealie_add_shopping_item',
        title: 'Add Mealie Shopping Item',
        description: 'Add one grocery item to a Mealie shopping list.',
        inputSchema: zodToJsonSchemaObject({
          shopping_list_id: { type: 'string', format: 'uuid' },
          item: { type: 'string', minLength: 1 },
          quantity: { type: 'number', default: 1, exclusiveMinimum: 0 },
          unit: { type: 'string', minLength: 1 },
          note: { type: 'string' },
        }, ['shopping_list_id', 'item']),
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      execute: async (args) => {
        const parsed = parseArgs(AddShoppingItemArgsSchema, args);
        return client ? jsonResult(await client.addShoppingItem({
          shoppingListId: parsed.shopping_list_id,
          item: parsed.item,
          quantity: parsed.quantity,
          unit: parsed.unit,
          note: parsed.note,
        })) : disabledResult('Mealie');
      },
    },
  ];
}
