import { HttpClient } from '../http.js';

export class MealieClient {
  constructor(private readonly http: HttpClient) {}

  searchRecipes(query: string, page = 1, perPage = 10): Promise<unknown> {
    return this.http.get('/api/recipes', { search: query, page, perPage });
  }

  getRecipe(slug: string): Promise<unknown> {
    return this.http.get(`/api/recipes/${encodeURIComponent(slug)}`);
  }

  createRecipeFromUrl(url: string, includeTags: boolean, includeCategories: boolean): Promise<unknown> {
    return this.http.post('/api/recipes/create/url', {
      url,
      includeTags,
      includeCategories,
    });
  }

  listShoppingLists(): Promise<unknown> {
    return this.http.get('/api/households/shopping/lists', { page: 1, perPage: 50 });
  }

  addShoppingItem(options: {
    shoppingListId: string;
    item: string;
    quantity: number;
    unit?: string;
    note?: string;
  }): Promise<unknown> {
    return this.http.post('/api/households/shopping/items', {
      shoppingListId: options.shoppingListId,
      display: options.item,
      food: {
        name: options.item,
      },
      quantity: options.quantity,
      unit: options.unit ? { name: options.unit } : undefined,
      note: options.note || '',
    });
  }
}
