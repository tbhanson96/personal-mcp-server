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

  queryHealthMetrics(from: string, to: string, metrics: string[]): Promise<unknown> {
    return this.http.get('/api/health', { from, to, metrics });
  }

  getHealthDashboard(from: string, to: string, metrics: string[], aggregation: 'hourly' | 'daily'): Promise<unknown> {
    return this.http.get('/api/health/dashboard', { from, to, metrics, aggregation });
  }

  getSleepData(from: string, to: string): Promise<unknown> {
    return this.http.get('/api/health/sleep', { from, to });
  }

  searchTorrents(search: string, category: 'movies' | 'tv'): Promise<unknown> {
    return this.http.get('/api/torrent', { search, category });
  }

  addTorrent(magnet: string, category: 'movies' | 'tv'): Promise<unknown> {
    return this.http.post('/api/torrent', { magnet, category });
  }
}
