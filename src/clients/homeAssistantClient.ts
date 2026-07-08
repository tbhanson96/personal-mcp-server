import { HttpClient } from '../http.js';

export class HomeAssistantClient {
  constructor(private readonly http: HttpClient) {}

  getConfig(): Promise<unknown> {
    return this.http.get('/api/config');
  }

  getStates(): Promise<unknown> {
    return this.http.get('/api/states');
  }

  getState(entityId: string): Promise<unknown> {
    return this.http.get(`/api/states/${encodeURIComponent(entityId)}`);
  }
}
