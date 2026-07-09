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

  getTask(taskId: number): Promise<Record<string, unknown>> {
    return this.http.get(`/api/v1/tasks/${taskId}`);
  }

  createTask(projectId: number, task: Record<string, unknown>): Promise<unknown> {
    return this.http.put(`/api/v1/projects/${projectId}/tasks`, task);
  }

  updateTask(taskId: number, updates: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/api/v1/tasks/${taskId}`, updates);
  }
}
