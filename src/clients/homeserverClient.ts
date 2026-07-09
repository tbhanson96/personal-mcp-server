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

  searchTorrents(search: string, category: 'movies' | 'tv'): Promise<unknown> {
    return this.http.get('/api/torrent', { search, category });
  }

  addTorrent(magnet: string, category: 'movies' | 'tv'): Promise<unknown> {
    return this.http.post('/api/torrent', { magnet, category });
  }
}
