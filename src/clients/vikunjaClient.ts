import { HttpClient } from '../http.js';

export class VikunjaClient {
  constructor(private readonly http: HttpClient) {}

  listProjects(): Promise<unknown> {
    return this.http.get('/api/v1/projects');
  }

  listTasks(options: { page?: number; perPage?: number; search?: string }): Promise<unknown> {
    return this.http.get('/api/v1/tasks/all', {
      page: options.page,
      per_page: options.perPage,
      s: options.search,
    });
  }
}
