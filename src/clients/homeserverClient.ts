import { HttpClient } from '../http.js';

export class HomeserverClient {
  constructor(private readonly http: HttpClient) {}

  listFiles(path = '/'): Promise<unknown> {
    return this.http.get('/api/files/path', { path });
  }

  listEbooks(library = 'books'): Promise<unknown> {
    return this.http.get('/api/ebooks', { library });
  }

  searchEbooks(search: string): Promise<unknown> {
    return this.http.get('/api/ebooks/libgen', { search });
  }

  getHealthCatalog(): Promise<unknown> {
    return this.http.get('/api/health/catalog');
  }
}
