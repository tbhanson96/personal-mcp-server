import { HttpClient } from '../http.js';

export class VikunjaClient {
  constructor(private readonly http: HttpClient) {}

  listProjects(): Promise<unknown> {
    return this.http.get('/api/v1/projects');
  }

  listTasks(options: { page?: number; per_page?: number; search?: string }): Promise<unknown> {
    return this.http.get('/api/v1/tasks', {
      page: options.page,
      per_page: options.per_page,
      s: options.search,
    });
  }
}
