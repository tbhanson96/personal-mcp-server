import { HttpClient } from '../http.js';

export class MealieClient {
  constructor(private readonly http: HttpClient) {}

  searchRecipes(query: string, page = 1, perPage = 10): Promise<unknown> {
    return this.http.get('/api/recipes', { search: query, page, perPage });
  }

  getRecipe(slug: string): Promise<unknown> {
    return this.http.get(`/api/recipes/${encodeURIComponent(slug)}`);
  }
}
