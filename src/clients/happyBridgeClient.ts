import { request } from 'node:http';

export type HappyBridgeRequest = Record<string, unknown>;

export class HappyBridgeClient {
  constructor(private readonly socketPath: string) {}

  async call<T>(path: string, body: HappyBridgeRequest = {}): Promise<T> {
    const payload = JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
      const req = request({
        socketPath: this.socketPath,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        timeout: 35_000,
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 1_000_000) {
            req.destroy(new Error('Happy bridge response exceeded 1 MB'));
          }
        });
        response.on('end', () => {
          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            reject(new Error(`Happy bridge returned invalid JSON (HTTP ${response.statusCode ?? 0})`));
            return;
          }

          if ((response.statusCode ?? 500) >= 400) {
            const message = typeof parsed === 'object' && parsed && 'error' in parsed
              ? String((parsed as { error: unknown }).error)
              : `Happy bridge request failed (HTTP ${response.statusCode ?? 500})`;
            reject(new Error(message));
            return;
          }

          resolve(parsed as T);
        });
      });

      req.on('timeout', () => req.destroy(new Error('Happy bridge request timed out')));
      req.on('error', reject);
      req.end(payload);
    });
  }
}
