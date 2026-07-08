import { HttpClient } from '../http.js';

export class HomeserverClient {
  constructor(private readonly http: HttpClient) {}

  listFiles(path = '/'): Promise<unknown> {
    return this.http.get('/files', { path });
  }

  listEbooks(library = 'books'): Promise<unknown> {
    return this.http.get('/ebooks', { library });
  }

  searchEbooks(search: string): Promise<unknown> {
    return this.http.get('/ebooks/search', { search });
  }

  getHealthCatalog(): Promise<unknown> {
    return this.http.get('/health/catalog');
  }
}
