import { ServiceConfig } from './config.js';

export class HttpClient {
  constructor(
    private readonly config: ServiceConfig,
    private readonly authHeader: 'Authorization' | 'x-api-key' = 'Authorization',
  ) {}

  async get<T>(path: string, query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          url.searchParams.append(key, String(entry));
        }
      } else if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.config.token) {
      headers[this.authHeader] = this.authHeader === 'Authorization'
        ? `Bearer ${this.config.token}`
        : this.config.token;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${url.pathname} failed: ${response.status} ${text.slice(0, 500)}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
