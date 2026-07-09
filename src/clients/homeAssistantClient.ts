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

  controlEntity(entityId: string, action: 'turn_on' | 'turn_off' | 'toggle'): Promise<unknown> {
    const domain = entityId.split('.')[0];
    return this.http.post(`/api/services/${encodeURIComponent(domain)}/${action}`, {
      entity_id: entityId,
    });
  }
}
